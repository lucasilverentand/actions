import { GitHub, ApiError } from './github.mjs';
import { inspectWorkflow } from './workflows.mjs';
import { boolean, escapeMarkdown, input, output, runIfMain, summary } from './runtime.mjs';

export async function auditRepository(api) {
  const findings = [];
  const add = (rule, message, level = 'error') => findings.push({ rule, message, level });
  const repo = await api.get('');
  const ref = repo.default_branch;
  if (!ref) throw new Error('Repository has no default branch.');
  if (!repo.description?.trim()) add('description', 'Add a repository description.', 'warning');
  if (!repo.delete_branch_on_merge) add('delete-merged-branches', 'Enable automatic deletion of merged pull request branches.');
  if (!repo.allow_squash_merge || repo.allow_merge_commit || repo.allow_rebase_merge) {
    add('merge-method', 'Enable squash merging and disable merge commits and rebase merging.');
  }
  if (repo.squash_merge_commit_title !== 'PR_TITLE' || repo.squash_merge_commit_message !== 'PR_BODY') {
    add('squash-message', 'Use the pull request title and body as the squash commit message.');
  }

  await inspect('branch-protection', async () => {
    const branch = encodeURIComponent(ref);
    const rules = await api.get(`/rules/branches/${branch}`);
    const types = new Set(rules.map((r) => r.type));
    let classic;
    // Classic protection and rulesets can complement one another.
    try { classic = await api.get(`/branches/${branch}/protection`); }
    catch (error) { if (!(error instanceof ApiError) || error.status !== 404) throw error; }
    if (!types.has('pull_request') && !classic?.required_pull_request_reviews) {
      add('require-pull-request', 'Require pull requests for the default branch.');
    }
    if (!types.has('required_status_checks') && !classic?.required_status_checks?.contexts?.length &&
        !classic?.required_status_checks?.checks?.length) {
      add('require-checks', 'Require CI status checks for the default branch.');
    }
    if (!types.has('non_fast_forward') && (!classic || classic.allow_force_pushes?.enabled !== false)) {
      add('block-force-push', 'Block force pushes to the default branch.');
    }
    if (!types.has('deletion') && (!classic || classic.allow_deletions?.enabled !== false)) {
      add('block-branch-deletion', 'Protect the default branch from deletion.');
    }
    const rulesRequireResolution = rules.some((r) => r.type === 'pull_request' && r.parameters?.required_review_thread_resolution);
    if (!rulesRequireResolution && !classic?.required_conversation_resolution?.enabled) {
      add('resolve-conversations', 'Require review conversations to be resolved.');
    }
    if (classic && !classic.enforce_admins?.enabled) add('admin-bypass', 'Classic branch protection permits administrator bypass.', 'warning');
  });

  await inspect('actions-permissions', async () => {
    const permissions = await api.get('/actions/permissions/workflow');
    if (permissions.default_workflow_permissions !== 'read') add('default-token', 'Make the default workflow token read-only.');
    if (permissions.can_approve_pull_request_reviews) add('actions-approval', 'Disable workflow permission to create and approve pull requests.');
  });
  await inspect('vulnerability-alerts', async () => {
    try { await api.get('/vulnerability-alerts'); }
    catch (error) {
      if (error instanceof ApiError && error.status === 404) add('vulnerability-alerts', 'Dependency alerts are disabled or this token cannot inspect them.');
      else throw error;
    }
  });
  if (repo.visibility === 'public' || repo.security_and_analysis?.secret_scanning) {
    for (const feature of ['secret_scanning', 'secret_scanning_push_protection']) {
      if (repo.security_and_analysis?.[feature]?.status !== 'enabled') {
        add(feature.replaceAll('_', '-'), `Enable ${feature.replaceAll('_', ' ')} or verify feature availability.`, 'warning');
      }
    }
  }

  await inspect('repository-files', async () => {
    const root = await api.get('/contents', { ref });
    if (!Array.isArray(root) || root.length >= 1000) throw new Error('Incomplete directory.');
    const github = await directory('.github');
    const docs = await directory('docs');
    const paths = [...root, ...github, ...docs].filter((f) => f.type === 'file').map((f) => f.path);
    const basename = (path) => path.split('/').at(-1);
    if (!paths.some((p) => /^readme(?:\.|$)/i.test(basename(p)))) add('readme', 'Add a README.', 'warning');
    if (!paths.some((p) => /^security(?:\.|$)/i.test(basename(p)))) add('security-policy', 'Add a SECURITY.md reporting policy (an inherited policy must be verified separately).', 'warning');
    if (repo.visibility === 'public' && !paths.some((p) => /^(?:licen[sc]e|copying)(?:\.|$)/i.test(basename(p)))) {
      add('license', 'Add a license to the public repository.', 'warning');
    }
    if (!paths.some((p) => /(?:^|\/)(?:dependabot\.ya?ml|\.?renovaterc(?:\.json5?)?|renovate\.json5?)$/i.test(p))) {
      add('dependency-updates', 'Configure Dependabot or Renovate (an external bot configuration must be verified separately).', 'warning');
    }
  });
  await inspect('workflow-audit', async () => {
    const workflows = await directory('.github/workflows');
    if (!workflows.length) add('workflows', 'Add CI workflows.', 'warning');
    for (const file of workflows.filter((f) => /\.ya?ml$/.test(f.name))) {
      findings.push(...inspectWorkflow(await api.file(file.path, ref), file.path));
    }
  });
  return findings;

  async function directory(path) {
    try {
      const entries = await api.get(`/contents/${path}`, { ref });
      if (!Array.isArray(entries) || entries.length >= 1000) throw new Error('Incomplete directory.');
      return entries;
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return [];
      throw error;
    }
  }

  async function inspect(rule, operation) {
    try { await operation(); }
    catch { add(rule, 'Inspection failed or the token lacks access; this check is unverified.'); }
  }
}

export async function main() {
  const api = new GitHub(input('token'));
  const findings = await auditRepository(api);
  output('findings', findings);
  output('passed', !findings.some((f) => f.level === 'error'));
  summary('Repository audit', findings.length ? [
    '| Level | Rule | Finding |', '| --- | --- | --- |',
    ...findings.map((f) => `| ${f.level} | ${f.rule} | ${escapeMarkdown(f.message)}${f.path ? ` (${escapeMarkdown(f.path)})` : ''} |`),
  ] : ['All inspected settings satisfy the policy.']);
  console.log(`${findings.filter((f) => f.level === 'error').length} errors; ${findings.filter((f) => f.level === 'warning').length} warnings. See the job summary.`);
  if (boolean(input('fail-on-error', 'true')) && findings.some((f) => f.level === 'error')) process.exitCode = 1;
}

runIfMain(import.meta, main);
