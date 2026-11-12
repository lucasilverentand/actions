export const knownRules = Object.freeze([
  'actions-approval', 'actions-permissions', 'admin-bypass', 'block-branch-deletion', 'block-force-push',
  'branch-protection', 'default-branch-head', 'default-token', 'delete-merged-branches', 'dependency-updates',
  'description', 'inspection', 'license', 'merge-method', 'readme', 'repository-files', 'require-checks',
  'require-pull-request', 'required-check', 'resolve-conversations', 'secret-scanning', 'secret-scanning-push-protection',
  'security-policy', 'squash-message', 'vulnerability-alerts', 'workflow-audit', 'workflow-checkout-credentials',
  'workflow-container-pin', 'workflow-injection', 'workflow-inspection', 'workflow-parse', 'workflow-permissions',
  'workflow-pin', 'workflow-privileged-checkout', 'workflow-removed', 'workflow-runner', 'workflow-secrets',
  'workflow-timeout', 'workflow-write-all', 'workflows',
]);

export function parseRules(text) {
  let value;
  try { value = JSON.parse(text); } catch { throw new Error('rules must be a JSON object of known rule ids and levels.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.entries(value).length > 100 ||
      Object.entries(value).some(([rule, level]) => !knownRules.includes(rule) || !['error', 'warning', 'off'].includes(level))) {
    throw new Error('rules must be a JSON object of known rule ids and levels.');
  }
  return value;
}

export function parseTrustedOwners(text) {
  let value;
  try { value = JSON.parse(text); } catch { throw new Error('trusted-owners must be a JSON array of up to 50 valid owner logins.'); }
  if (!Array.isArray(value) || value.length > 50 || value.some((owner) => typeof owner !== 'string' || !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(owner))) {
    throw new Error('trusted-owners must be a JSON array of up to 50 valid owner logins.');
  }
  return value;
}

export function applyRules(findings, rules = {}) {
  return findings.flatMap((finding) => {
    if (finding.unverified || !Object.hasOwn(rules, finding.rule)) return [finding];
    if (rules[finding.rule] === 'off') return [];
    return [{ ...finding, level: rules[finding.rule] }];
  });
}
