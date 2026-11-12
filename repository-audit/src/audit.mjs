import { applyRules } from '../../lib/rules.mjs';
import { ApiError } from '../../lib/github.mjs';
import { inspectWorkflow } from './workflows.mjs';
import { mapConcurrent } from '../../lib/concurrency.mjs';

export async function auditRepository(api, { requiredChecks = [], rules = {}, trustedOwners = [] } = {}) {
  if (!Array.isArray(requiredChecks) || requiredChecks.length > 100 || requiredChecks.some((check) => typeof check !== 'string' || !check.trim() || check !== check.trim())) {
    throw new Error('required-checks must be a JSON array of nonempty check names.');
  }
  const findings = [];
  const add = (rule, message, level = 'error') => findings.push({ rule, message, level });
  const repo = await api.get('');
  const ref = repo.default_branch;
  if (!ref) throw new Error('Repository has no default branch.');
  if (!repo.description?.trim()) add('description', 'Add a repository description.', 'warning');
  // A token without write access gets no merge settings here; absent is unknown, not disabled.
  let merge = typeof repo.delete_branch_on_merge === 'boolean' ? repo : null;
  if (!merge) await inspect('merge-settings', async () => { merge = await api.mergeSettings(); });
  if (merge) {
    if (!merge.delete_branch_on_merge) add('delete-merged-branches', 'Enable automatic deletion of merged pull request branches.');
    if (!merge.allow_squash_merge || merge.allow_merge_commit || merge.allow_rebase_merge) {
      add('merge-method', 'Enable squash merging and disable merge commits and rebase merging.');
    }
    if (merge.squash_merge_commit_title !== 'PR_TITLE' || merge.squash_merge_commit_message !== 'PR_BODY') {
      add('squash-message', 'Use the pull request title and body as the squash commit message.');
    }
  }

  await inspect('branch-protection', async () => {
    const branch = encodeURIComponent(ref);
    const rules = await api.list(`/rules/branches/${branch}`);
    const types = new Set(rules.map((r) => r.type));
    let classic;
    // Classic protection and rulesets can complement one another.
    try { classic = await api.get(`/branches/${branch}/protection`); }
    catch (error) { if (!(error instanceof ApiError) || error.status !== 404) throw error; }
    if (!types.has('pull_request') && !classic?.required_pull_request_reviews) {
      add('require-pull-request', 'Require pull requests for the default branch.');
    }
    const checkNames = new Set([
      ...rules.filter((rule) => rule.type === 'required_status_checks').flatMap((rule) =>
        (rule.parameters?.required_status_checks ?? []).map((check) => check.context)),
      ...(classic?.required_status_checks?.contexts ?? []),
      ...(classic?.required_status_checks?.checks ?? []).map((check) => check.context),
    ].filter((check) => typeof check === 'string' && check.trim()));
    if (!checkNames.size) {
      add('require-checks', 'Require CI status checks for the default branch.');
    }
    for (const check of requiredChecks) {
      if (!checkNames.has(check)) add('required-check', `Require the configured CI status check: ${check}.`);
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

  let contentRef;
  await inspect('default-branch-head', async () => {
    const commit = await api.get(`/commits/${encodeURIComponent(ref)}`);
    if (!/^[a-f0-9]{40}$/.test(commit.sha ?? '')) throw new Error('Invalid commit.');
    contentRef = commit.sha;
  });
  if (contentRef) await inspect('repository-files', async () => {
    const root = await api.get('/contents', { ref: contentRef });
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
  if (contentRef) await inspect('workflow-audit', async () => {
    const workflows = await directory('.github/workflows');
    if (!workflows.length) add('workflows', 'Add CI workflows.', 'warning');
    const inspected = await mapConcurrent(workflows.filter((file) => /\.ya?ml$/.test(file.name)), 4,
      async (file) => inspectWorkflow(await api.file(file.path, contentRef), file.path, { trustedOwners }));
    findings.push(...inspected.flat());
  });
  return applyRules(findings, rules);

  async function directory(path) {
    try {
      const entries = await api.get(`/contents/${path}`, { ref: contentRef });
      if (!Array.isArray(entries) || entries.length >= 1000) throw new Error('Incomplete directory.');
      return entries;
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return [];
      throw error;
    }
  }

  async function inspect(rule, operation) {
    try { await operation(); }
    catch { findings.push({ rule, message: 'Inspection failed or the token lacks access; this check is unverified.', level: 'error', unverified: true }); }
  }
}

