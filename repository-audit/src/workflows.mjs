import { parseDocument } from 'yaml';

const mapping = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const permissions = new Set(['actions', 'artifact-metadata', 'attestations', 'checks', 'contents', 'deployments', 'discussions', 'id-token', 'issues', 'models', 'packages', 'pages', 'pull-requests', 'security-events', 'statuses']);

export function inspectWorkflow(source, path, options = {}) {
  const findings = [];
  const add = (rule, message) => findings.push({ rule, message, path, level: 'error' });
  try {
    const document = parseDocument(source, { uniqueKeys: true });
    if (document.errors.length || document.warnings.length) throw new Error('Invalid or unsupported YAML.');
    const workflow = document.toJS({ maxAliasCount: 50 });
    if (!mapping(workflow) || !mapping(workflow.jobs) || !Object.keys(workflow.jobs).length) {
      throw new Error('Invalid workflow.');
    }
    const triggers = typeof workflow.on === 'string' ? [workflow.on]
      : Array.isArray(workflow.on) ? workflow.on : mapping(workflow.on) ? Object.keys(workflow.on) : [];
    if (!triggers.length || triggers.some((name) => typeof name !== 'string' || !/^[a-z][a-z0-9_]*$/.test(name))) {
      throw new Error('Invalid workflow triggers.');
    }
    const privileged = triggers.includes('pull_request_target') || triggers.includes('workflow_run');
    if (!Object.hasOwn(workflow, 'permissions')) add('workflow-permissions', 'Declare workflow-level token permissions explicitly.');
    else inspectPermissions(workflow.permissions);
    for (const job of Object.values(workflow.jobs)) {
      if (!mapping(job)) throw new Error('Invalid job.');
      if (Object.hasOwn(job, 'permissions')) inspectPermissions(job.permissions);
      if (job.uses) inspectUses(job.uses);
      else if (!job['runs-on'] || !Array.isArray(job.steps) || !job.steps.length) throw new Error('Invalid executable job.');
      if (job['secrets'] === 'inherit') add('workflow-secrets', 'Pass only the secrets a reusable workflow needs.');
      // Require an explicit bound, not a short one: long native builds and archives are legitimate.
      if (job['runs-on'] && (!Number.isFinite(job['timeout-minutes']) || job['timeout-minutes'] < 1)) {
        add('workflow-timeout', 'Set an explicit job timeout of at least 1 minute.');
      }
      if (triggers.some((t) => ['pull_request', 'pull_request_target'].includes(t)) &&
          JSON.stringify(job['runs-on'] ?? '').includes('self-hosted') && !trustedPullRequestGate(job.if, triggers)) {
        add('workflow-runner', 'Use GitHub-hosted PR runners or an explicit job gate that excludes fork PRs from persistent runners.');
      }
      if (job.container !== undefined) inspectContainer(job.container);
      if (job.services !== undefined) {
        if (!mapping(job.services)) throw new Error('Invalid services.');
        for (const service of Object.values(job.services)) inspectContainer(service);
      }
      if (job.steps !== undefined && !Array.isArray(job.steps)) throw new Error('Invalid steps.');
      for (const step of job.steps ?? []) {
        if (!mapping(step) || (typeof step.run !== 'string' && typeof step.uses !== 'string') ||
            (step.run !== undefined && step.uses !== undefined)) throw new Error('Invalid step.');
        if (step.uses) {
          inspectUses(step.uses);
          if (/^actions\/checkout@/i.test(step.uses)) {
            if (privileged) add('workflow-privileged-checkout', 'Review privileged event workflows: checkout is forbidden by this policy.');
            if (step.with?.['persist-credentials'] !== false && step.with?.['persist-credentials'] !== 'false') {
              add('workflow-checkout-credentials', 'Set persist-credentials: false on checkout.');
            }
          }
        }
        for (const script of [step.run, step.with?.script]) {
          // Normalize literal bracket access before matching context expressions.
          const normalized = typeof script === 'string' ? script.replace(/\[\s*['"]([A-Za-z_][A-Za-z0-9_-]*)['"]\s*\]/g, '.$1') : '';
          if (/\$\{\{(?:(?!\}\})[\s\S])*(?:github\s*\.\s*(?:event|head_ref|ref_name)(?![A-Za-z0-9_])|inputs\s*(?:\.|\[))(?:(?!\}\})[\s\S])*\}\}/i.test(normalized)) {
            add('workflow-injection', 'Pass event data and inputs through environment variables instead of interpolating them into scripts.');
          }
        }
      }
    }
  } catch {
    findings.push({ rule: 'workflow-parse', message: 'Could not safely parse this workflow; inspect its YAML and structure.', path, level: 'error', unverified: true });
  }
  return findings;

  function inspectPermissions(value) {
    if (value === 'write-all') return add('workflow-write-all', 'Grant only the token permissions each job needs.');
    if (value === 'read-all') return;
    if (!mapping(value) || Object.entries(value).some(([scope, access]) => !permissions.has(scope) ||
        !(scope === 'id-token' ? ['write', 'none'] : scope === 'models' ? ['read', 'none'] : ['read', 'write', 'none']).includes(access))) {
      add('workflow-permissions', 'Token permissions must be an explicit supported permission map or read-all.');
    }
  }

  function inspectContainer(value) {
    const image = mapping(value) ? value.image : value;
    if (typeof image !== 'string' || !/^[^\s@]+@sha256:[a-f0-9]{64}$/.test(image)) {
      add('workflow-container-pin', 'Pin job and service container images to SHA-256 digests.');
    }
  }

  function trustedReference(uses) {
    const match = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)(?:\/[A-Za-z0-9_.-]+)*@([^\s@]+)$/.exec(uses);
    return !!match && (options.trustedOwners ?? []).some((owner) => owner.toLowerCase() === match[1].toLowerCase());
  }

  function inspectUses(uses) {
    if (typeof uses !== 'string') return add('workflow-pin', 'Action references must be literal strings.');
    if (uses.startsWith('./')) return;
    if (uses.startsWith('docker://')) {
      if (!/@sha256:[a-f0-9]{64}$/.test(uses)) add('workflow-pin', 'Pin container actions to a SHA-256 digest.');
    } else if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_./-]+@[a-f0-9]{40}$/.test(uses) && !trustedReference(uses)) {
      add('workflow-pin', 'Pin external actions and reusable workflows to full commit SHAs.');
    }
  }
}

// Recognize only two narrow, documented gates. This is not a general expression evaluator.
export function trustedPullRequestGate(condition, triggers) {
  if (typeof condition !== 'string') return false;
  const normalized = condition.trim().replace(/^\$\{\{\s*([\s\S]*?)\s*\}\}$/, '$1').replace(/\s+/g, ' ').trim();
  const sameRepository = 'github.event.pull_request.head.repo.full_name == github.repository';
  if (normalized === sameRepository) return true;
  return !triggers.includes('pull_request_target') && ["'pull_request'", '"pull_request"'].some((name) =>
    normalized === `github.event_name != ${name} || ${sameRepository}`);
}
