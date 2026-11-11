import test from 'node:test';
import assert from 'node:assert/strict';
import { auditRepository } from '../src/index.mjs';
import { ApiError, GitHub } from '../../lib/github.mjs';

function fixture(overrides = {}) {
  const repo = {
    description: 'Example project', default_branch: 'main', visibility: 'public',
    delete_branch_on_merge: true, allow_squash_merge: true, allow_merge_commit: false, allow_rebase_merge: false,
    squash_merge_commit_title: 'PR_TITLE', squash_merge_commit_message: 'PR_BODY',
    security_and_analysis: { secret_scanning: { status: 'enabled' }, secret_scanning_push_protection: { status: 'enabled' } },
  };
  const rules = ['pull_request', 'required_status_checks', 'non_fast_forward', 'deletion'].map((type) => ({ type,
    parameters: { required_review_thread_resolution: true, required_status_checks: [{ context: 'CI' }] },
  }));
  return {
    list: GitHub.prototype.list,
    async get(path) {
      if (overrides.fail === path) throw new ApiError(403);
      if (!path) return { ...repo, ...overrides.repo };
      if (path.startsWith('/commits/')) return { sha: 'a'.repeat(40) };
      if (path.startsWith('/rules/')) return overrides.rules ?? rules;
      if (path.endsWith('/protection')) {
        if (overrides.classic) return overrides.classic;
        throw new ApiError(404);
      }
      if (path === '/actions/permissions/workflow') return { default_workflow_permissions: 'read', can_approve_pull_request_reviews: false };
      if (path === '/vulnerability-alerts') return null;
      if (path === '/contents') return ['README.md', 'LICENSE', 'SECURITY.md', 'renovate.json'].map((path) => ({ path, type: 'file' }));
      if (path === '/contents/.github/workflows') return [{ name: 'ci.yml', path: '.github/workflows/ci.yml' }];
      if (path.startsWith('/contents/')) throw new ApiError(404);
      throw new Error('Unexpected API path');
    },
    async file() { return 'on: push\npermissions: {}\njobs:\n  check:\n    runs-on: ubuntu-latest\n    timeout-minutes: 10\n    steps:\n      - run: echo ok\n'; },
  };
}

test('accepts protected settings and safe workflows', async () => {
  assert.deepEqual(await auditRepository(fixture()), []);
});

test('required protections and CI checks can appear on later rule pages', async () => {
  const api = fixture();
  const get = api.get;
  const rules = [...Array.from({ length: 100 }, () => ({ type: 'required_signatures' })), ...await get('/rules/branches/main')];
  api.get = (path, query) => path.startsWith('/rules/')
    ? rules.slice((query.page - 1) * query.per_page, query.page * query.per_page) : get(path, query);
  assert.deepEqual(await auditRepository(api, { requiredChecks: ['CI'] }), []);
});
test('reports permission failures as unverified errors', async () => {
  const findings = await auditRepository(fixture({ fail: '/actions/permissions/workflow' }));
  assert.ok(findings.some((f) => f.rule === 'actions-permissions' && f.level === 'error' && f.message.includes('unverified')));
});
test('reports missing branch rules and drifted merge settings', async () => {
  const findings = await auditRepository(fixture({ rules: [], repo: { allow_merge_commit: true, delete_branch_on_merge: false } }));
  for (const rule of ['merge-method', 'delete-merged-branches', 'require-pull-request', 'require-checks', 'block-force-push', 'block-branch-deletion']) {
    assert.ok(findings.some((f) => f.rule === rule), rule);
  }
});
test('accepts classic protection and rulesets together', async () => {
  const findings = await auditRepository(fixture({ rules: [], classic: {
    required_pull_request_reviews: {}, required_status_checks: { checks: [{ context: 'CI' }] },
    allow_force_pushes: { enabled: false }, allow_deletions: { enabled: false },
    required_conversation_resolution: { enabled: true }, enforce_admins: { enabled: true },
  } }));
  assert.deepEqual(findings, []);
});

test('a required-status-check rule with no named checks does not satisfy the baseline', async () => {
  const rules = ['pull_request', 'required_status_checks', 'non_fast_forward', 'deletion'].map((type) => ({ type,
    parameters: { required_review_thread_resolution: true, required_status_checks: [] },
  }));
  const findings = await auditRepository(fixture({ rules }));
  assert.ok(findings.some((finding) => finding.rule === 'require-checks'));
});

test('configured required checks combine classic settings and rulesets', async () => {
  const api = fixture({ classic: {
    required_status_checks: { contexts: ['Lint'] }, enforce_admins: { enabled: true },
  } });
  assert.deepEqual(await auditRepository(api, { requiredChecks: ['CI', 'Lint'] }), []);
  const missing = await auditRepository(api, { requiredChecks: ['CI', 'Security'] });
  assert.ok(missing.some((finding) => finding.rule === 'required-check' && finding.message.includes('Security')));
  for (const value of ['CI', [null], [''], [' CI']]) {
    await assert.rejects(auditRepository(api, { requiredChecks: value }));
  }
});

test('all repository files and workflow contents use one immutable default-branch commit', async () => {
  const api = fixture();
  const reads = [];
  const get = api.get;
  const file = api.file;
  api.get = async (path, query) => {
    if (path.startsWith('/contents')) reads.push(query.ref);
    return get(path, query);
  };
  api.file = async (path, ref) => { reads.push(ref); return file(path, ref); };
  assert.deepEqual(await auditRepository(api), []);
  assert.ok(reads.length >= 4);
  assert.ok(reads.every((ref) => ref === 'a'.repeat(40)));
});

test('failure to resolve the default-branch commit is unverified and never falls back to mutable reads', async () => {
  const api = fixture({ fail: '/commits/main' });
  api.file = () => { throw new Error('Must not read mutable contents'); };
  const findings = await auditRepository(api);
  assert.ok(findings.some((finding) => finding.rule === 'default-branch-head' && finding.level === 'error'));
});

test('repository workflow reads are bounded and preserve directory order', async () => {
  const api = fixture();
  const get = api.get;
  const entries = Array.from({ length: 7 }, (_, index) => ({ name: `${index}.yml`, path: `.github/workflows/${index}.yml` }));
  api.get = (path, query) => path === '/contents/.github/workflows' ? entries : get(path, query);
  let active = 0;
  let maximum = 0;
  api.file = async (path) => {
    active++;
    maximum = Math.max(maximum, active);
    await new Promise((resolve) => setTimeout(resolve, path.includes('/0.') ? 8 : 1));
    active--;
    return 'on: push\npermissions: write-all\njobs:\n  check:\n    runs-on: ubuntu-latest\n    timeout-minutes: 10\n    steps:\n      - run: echo ok\n';
  };
  const findings = await auditRepository(api);
  assert.equal(maximum, 4);
  assert.equal(active, 0);
  assert.deepEqual(findings.map((finding) => finding.path), entries.map((entry) => entry.path));
});
