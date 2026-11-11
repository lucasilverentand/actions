import test from 'node:test';
import assert from 'node:assert/strict';
import { auditRepository } from '../src/index.mjs';
import { ApiError } from '../../lib/github.mjs';

function fixture(overrides = {}) {
  const repo = {
    description: 'Example project', default_branch: 'main', visibility: 'public',
    delete_branch_on_merge: true, allow_squash_merge: true, allow_merge_commit: false, allow_rebase_merge: false,
    squash_merge_commit_title: 'PR_TITLE', squash_merge_commit_message: 'PR_BODY',
    security_and_analysis: { secret_scanning: { status: 'enabled' }, secret_scanning_push_protection: { status: 'enabled' } },
  };
  const rules = ['pull_request', 'required_status_checks', 'non_fast_forward', 'deletion'].map((type) => ({ type,
    parameters: { required_review_thread_resolution: true },
  }));
  return {
    async get(path) {
      if (overrides.fail === path) throw new ApiError(403);
      if (!path) return { ...repo, ...overrides.repo };
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
