import { applyRules, parseRules, parseTrustedOwners } from '../../lib/rules.mjs';
import { ApiError, GitHub } from '../../lib/github.mjs';
import { boolean, escapeMarkdown, event, input, output, runIfMain, summary } from '../../lib/runtime.mjs';
import { inspectWorkflow } from '../../repository-audit/src/workflows.mjs';
import { mapConcurrent } from '../../lib/concurrency.mjs';

const sha = (value) => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const workflowPath = (value) => typeof value === 'string' && /^\.github\/workflows\/[^/]+\.ya?ml$/.test(value);
const supportedEvents = new Set(['pull_request', 'pull_request_target', 'schedule', 'workflow_dispatch']);

export async function inspectWorkflows(api, { eventName, payload = {}, rules = {}, trustedOwners = [] }) {
  if (!supportedEvents.has(eventName)) throw new Error('Unsupported workflow policy event.');
  const result = { findings: [], inspectedSha: null, inspectedCount: 0 };
  const add = (rule, message, level = 'error', path) => result.findings.push({ rule, message, level, ...(path ? { path } : {}) });
  try {
    let paths;
    if (eventName === 'pull_request' || eventName === 'pull_request_target') {
      const base = payload.pull_request?.base?.sha;
      const head = payload.pull_request?.head?.sha;
      if (!sha(base) || !sha(head)) throw new Error('Missing or invalid PR metadata.');
      // Compare complete directories at immutable commits, using the resolved merge base.
      const comparison = await api.get(`/compare/${base}...${head}`, { per_page: 1 });
      if (comparison.base_commit?.sha !== base || !sha(comparison.merge_base_commit?.sha)) {
        throw new Error('Cannot establish immutable comparison.');
      }
      const [original, proposed] = await mapConcurrent([comparison.merge_base_commit.sha, head], 2,
        (ref) => workflowDirectory(api, ref));
      result.inspectedSha = head;
      paths = [...proposed].filter(([path, blob]) => original.get(path) !== blob).map(([path]) => path);
      for (const path of original.keys()) {
        if (!proposed.has(path)) add('workflow-removed', 'This workflow was removed; confirm required checks and replacement coverage.', 'warning', path);
      }
    } else {
      const repo = await api.get('');
      if (!repo.default_branch) throw new Error('Missing default branch.');
      const commit = await api.get(`/commits/${encodeURIComponent(repo.default_branch)}`);
      if (!sha(commit.sha)) throw new Error('Invalid default-branch commit.');
      result.inspectedSha = commit.sha;
      paths = [...(await workflowDirectory(api, commit.sha)).keys()];
      if (!paths.length) add('workflows', 'No default-branch workflow files were found.', 'warning');
    }
    // Contents are fetched by immutable commit, never by attacker-controlled raw/download URLs.
    const inspected = await mapConcurrent(paths, 4,
      async (path) => inspectWorkflow(await api.file(path, result.inspectedSha), path, { trustedOwners }));
    result.findings.push(...inspected.flat());
    result.inspectedCount = paths.length;
  } catch {
    result.findings.push({ rule: 'workflow-inspection', message: 'Inspection is unverified: check token access, event metadata, and file limits.', level: 'error', unverified: true });
  }
  result.findings = applyRules(result.findings, rules);
  return result;
}

async function workflowDirectory(api, ref) {
  let entries;
  try { entries = await api.get('/contents/.github/workflows', { ref }); }
  catch (error) {
    if (!(error instanceof ApiError) || error.status !== 404) throw error;
    entries = [];
  }
  if (!Array.isArray(entries) || entries.length >= 1000 || entries.truncated ||
      new Set(entries.map((entry) => entry?.path)).size !== entries.length || entries.some((entry) =>
        !entry || typeof entry.path !== 'string' || !/^\.github\/workflows\/[^/]+$/.test(entry.path) ||
        entry.name !== entry.path.split('/').at(-1) || ['.', '..'].includes(entry.name) || !sha(entry.sha) ||
        !['file', 'dir', 'symlink', 'submodule'].includes(entry.type) ||
        (workflowPath(entry.path) && (entry.type !== 'file' || entry.target || entry.submodule_git_url)))) {
    throw new Error('Incomplete or unsupported workflow directory.');
  }
  return new Map(entries.filter((entry) => workflowPath(entry.path)).map((entry) => [entry.path, entry.sha]));
}

export async function main() {
  const api = new GitHub(input('token'));
  const result = await inspectWorkflows(api, { eventName: process.env.GITHUB_EVENT_NAME, payload: event(), rules: parseRules(input('rules', '{}')), trustedOwners: parseTrustedOwners(input('trusted-owners', '[]')) });
  const passed = !result.findings.some((finding) => finding.level === 'error');
  output('findings', result.findings);
  output('passed', passed);
  output('inspected-sha', result.inspectedSha);
  output('inspected-count', result.inspectedCount);
  summary('Workflow policy', [
    `Inspected ${result.inspectedCount} workflow files at ${result.inspectedSha ?? 'an unverified revision'}.`, '',
    ...result.findings.map((finding) => `- ${finding.level}: ${escapeMarkdown(finding.message)}${finding.path ? ` (${escapeMarkdown(finding.path)})` : ''}`),
    ...(result.findings.length ? [] : ['All inspected workflows satisfy the policy.']),
  ]);
  if (boolean(input('fail-on-error', 'true')) && !passed) process.exitCode = 1;
}

runIfMain(import.meta, main);
