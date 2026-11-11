import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { cleanupBranches, retained, oldEnough } from '../src/branch-cleanup.mjs';

const execute = promisify(execFile);
const sha = 'a'.repeat(40);
const old = '2025-01-01T00:00:00Z';
const now = Date.parse('2026-01-01T00:00:00Z');
const options = { dryRun: true, days: 30, now, maxDeletions: 10, extraPrefixes: [] };

function fixture(overrides = {}) {
  const repo = { id: 1, owner: { login: 'example' }, default_branch: 'main' };
  const branch = { name: 'fix/old-bug', protected: false, commit: { sha } };
  const pr = { head: { ref: branch.name, sha, repo: { id: 1 } }, base: { ref: 'main' }, merged_at: old };
  let branchReads = 0;
  return {
    async get(path) {
      if (!path) return { ...repo, ...overrides.repo };
      if (path.startsWith('/rules/')) {
        if (overrides.failRules) throw new Error('403');
        return overrides.rules ?? [];
      }
      if (path.startsWith('/commits/')) return { commit: { committer: { date: overrides.date ?? old }, author: { date: old } } };
      if (path.startsWith('/branches/')) return { ...branch, ...overrides.currentBranch, commit: { sha: overrides.moved ? 'b'.repeat(40) : sha } };
      throw new Error(`Unexpected ${path}`);
    },
    async list(path, query) {
      if (path === '/branches') return Array.from({ length: overrides.count ?? 1 }, (_, i) => ({ ...branch, name: overrides.name ?? `fix/old-bug${i || ''}`, ...overrides.branch }));
      if (query.state === 'open') {
        branchReads++;
        return overrides.open || (overrides.openLater && branchReads > 1) ? [pr] : [];
      }
      return overrides.merged === false ? [] : [{ ...pr, ...overrides.pr }];
    },
  };
}

test('retains default, long-lived, release and additional configured branches', () => {
  for (const name of ['main', 'production', 'release/1.0', 'hotfix/urgent', 'custom', 'keep/work']) {
    assert.equal(retained(name, 'custom', ['keep/']), true);
  }
  assert.equal(retained('fix/bug', 'main'), false);
  assert.equal(oldEnough('invalid', 30, now), false);
});
test('dry run reports exact-tip merged candidates without calling delete', async () => {
  const result = await cleanupBranches(fixture(), options, () => assert.fail('Deletion in dry run'));
  assert.equal(result.candidates.length, 1);
  assert.equal(result.deleted.length, 0);
});
test('deletes only after rechecking eligibility', async () => {
  let deleted = 0;
  const result = await cleanupBranches(fixture(), { ...options, dryRun: false }, async () => deleted++);
  assert.equal(deleted, 1);
  assert.equal(result.deleted.length, 1);
});
test('retains unmerged, changed-tip, recent, protected, ruled, open PR and wrong-base branches', async () => {
  for (const change of [
    { merged: false }, { pr: { head: { ref: 'fix/old-bug', sha: 'b'.repeat(40), repo: { id: 1 } } } },
    { date: '2025-12-31T00:00:00Z' }, { branch: { protected: true } },
    { rules: [{ type: 'deletion' }] }, { open: true },
    { pr: { base: { ref: 'release/1' } } }, { pr: { merged_at: '2025-12-31T00:00:00Z' } },
  ]) {
    const result = await cleanupBranches(fixture(change), options, () => assert.fail('Unsafe deletion'));
    assert.equal(result.candidates.length, 0, JSON.stringify(change));
  }
});
test('skips branches that move or acquire an open PR between discovery and deletion', async () => {
  for (const change of [{ moved: true }, { openLater: true }, { currentBranch: { protected: true } }]) {
    const result = await cleanupBranches(fixture(change), { ...options, dryRun: false }, () => assert.fail('Raced deletion'));
    assert.equal(result.deleted.length, 0);
  }
});
test('API failures and excessive deletion counts abort without deleting', async () => {
  await assert.rejects(cleanupBranches(fixture({ failRules: true }), options));
  // maxDeletions is checked after collecting all candidates.
  await assert.rejects(cleanupBranches(fixture(), { ...options, maxDeletions: 0 }, () => assert.fail('Deletion despite limit')));
});
test('fork and archived repositories cannot be cleaned', async () => {
  for (const repo of [{ fork: true }, { archived: true }]) await assert.rejects(cleanupBranches(fixture({ repo }), options));
});
test('git force-with-lease refuses deletion after a concurrent push', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lease-test-'));
  const remote = join(dir, 'remote.git');
  const client = join(dir, 'client.git');
  const git = (args, cwd = client, extra = {}) => execute('git', args, { cwd, env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', ...extra } });
  try {
    await execute('git', ['init', '--bare', '--quiet', remote]);
    await execute('git', ['init', '--bare', '--quiet', client]);
    const tree = (await git(['hash-object', '-w', '-t', 'tree', '/dev/null'], client, {}));
    const env = { GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.com', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.com' };
    const first = (await git(['commit-tree', tree.stdout.trim(), '-m', 'first'], client, env)).stdout.trim();
    const second = (await git(['commit-tree', tree.stdout.trim(), '-p', first, '-m', 'second'], client, env)).stdout.trim();
    await git(['push', remote, `${second}:refs/heads/fix/test`]);
    await assert.rejects(git(['push', `--force-with-lease=refs/heads/fix/test:${first}`, remote, ':refs/heads/fix/test']));
    assert.match((await git(['ls-remote', remote, 'refs/heads/fix/test'])).stdout, new RegExp(second));
    await git(['push', `--force-with-lease=refs/heads/fix/test:${second}`, remote, ':refs/heads/fix/test']);
    assert.equal((await git(['ls-remote', remote, 'refs/heads/fix/test'])).stdout, '');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
