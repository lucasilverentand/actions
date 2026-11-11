import { parseDocument } from 'yaml';

export function inspectWorkflow(source, path) {
  const findings = [];
  const add = (rule, message) => findings.push({ rule, message, path, level: 'error' });
  try {
    const document = parseDocument(source, { uniqueKeys: true });
    if (document.errors.length) throw new Error('Invalid YAML.');
    const workflow = document.toJS({ maxAliasCount: 50 });
    if (!workflow || typeof workflow !== 'object' || !workflow.jobs || typeof workflow.jobs !== 'object') {
      throw new Error('Invalid workflow.');
    }
    const triggers = typeof workflow.on === 'string' ? [workflow.on]
      : Array.isArray(workflow.on) ? workflow.on : Object.keys(workflow.on ?? {});
    const privileged = triggers.includes('pull_request_target') || triggers.includes('workflow_run');
    if (!Object.hasOwn(workflow, 'permissions')) add('workflow-permissions', 'Declare workflow-level token permissions explicitly.');
    if (workflow.permissions === 'write-all') add('workflow-write-all', 'Grant write permissions only to the jobs that need them.');
    for (const job of Object.values(workflow.jobs)) {
      if (!job || typeof job !== 'object') throw new Error('Invalid job.');
      if (job.permissions === 'write-all') add('workflow-write-all', 'Avoid write-all job permissions.');
      if (job.uses) inspectUses(job.uses);
      if (job['secrets'] === 'inherit') add('workflow-secrets', 'Pass only the secrets a reusable workflow needs.');
      if (job['runs-on'] && (!Number.isFinite(job['timeout-minutes']) || job['timeout-minutes'] < 1 || job['timeout-minutes'] > 60)) {
        add('workflow-timeout', 'Set a job timeout between 1 and 60 minutes.');
      }
      if (triggers.some((t) => ['pull_request', 'pull_request_target'].includes(t)) &&
          JSON.stringify(job['runs-on'] ?? '').includes('self-hosted')) {
        add('workflow-runner', 'Use GitHub-hosted runners for pull request workflows.');
      }
      for (const step of job.steps ?? []) {
        if (step.uses) {
          inspectUses(step.uses);
          if (/^actions\/checkout@/.test(step.uses)) {
            if (privileged) add('workflow-privileged-checkout', 'Review privileged event workflows: checkout is forbidden by this policy.');
            if (step.with?.['persist-credentials'] !== false && step.with?.['persist-credentials'] !== 'false') {
              add('workflow-checkout-credentials', 'Set persist-credentials: false on checkout.');
            }
          }
        }
        for (const script of [step.run, step.with?.script]) {
          if (typeof script === 'string' && /\$\{\{(?:(?!\}\})[\s\S])*(?:github\.(?:event|head_ref|ref_name)|inputs\.)(?:(?!\}\})[\s\S])*\}\}/.test(script)) {
            add('workflow-injection', 'Pass event data and inputs through environment variables instead of interpolating them into scripts.');
          }
        }
      }
    }
  } catch {
    add('workflow-parse', 'Could not safely parse this workflow; inspect its YAML and structure.');
  }
  return findings;

  function inspectUses(uses) {
    if (typeof uses !== 'string') return add('workflow-pin', 'Action references must be literal strings.');
    if (uses.startsWith('./')) return;
    if (uses.startsWith('docker://')) {
      if (!/@sha256:[a-f0-9]{64}$/.test(uses)) add('workflow-pin', 'Pin container actions to a SHA-256 digest.');
    } else if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_./-]+@[a-f0-9]{40}$/.test(uses)) {
      add('workflow-pin', 'Pin external actions and reusable workflows to full commit SHAs.');
    }
  }
}
