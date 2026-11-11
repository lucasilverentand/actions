import test from 'node:test';
import assert from 'node:assert/strict';
import { checkCommitMessage } from '../../lib/commit-policy.mjs';
import { commitRange, readCommits, inspectCommits } from '../src/index.mjs';

const before = 'a'.repeat(40);
const after = 'b'.repeat(40);
const repo = { full_name: 'example/project' };
const commit = (id, message = 'fix: handle empty input') => ({ sha: id, commit: { message } });
const response = (commits, total = commits.length) => ({ total_commits: total, base_commit: { sha: before }, commits });

test('validates commit subjects, blank body separators, scope, and Unicode lengths', () => {
  for (const message of ['fix: handle empty input', 'feat!: replace old API\n\nBREAKING CHANGE: the old API was removed', 'docs: explain setup\r\n\r\nDocument supported runtimes.']) {
    assert.deepEqual(checkCommitMessage(message), []);
  }
  for (const message of ['Fix: upper case type', 'fix: ', 'fixup! fix: handle input', 'fix: handle input\nMissing separator', 'fix: unsafe\u202e subject', `fix: ${'a'.repeat(73)}`]) {
    assert.ok(checkCommitMessage(message).length, message);
  }
  assert.deepEqual(checkCommitMessage(`fix: ${'😀'.repeat(72)}`), []);
  assert.ok(checkCommitMessage('fix(core): handle input', { allowScopes: false }).length);
});

test('selects immutable event SHAs and rejects unsupported or mismatched events', () => {
  assert.deepEqual(commitRange({ repository: repo, ref: 'refs/heads/main', before, after }, 'push', repo.full_name), { before, after });
  assert.deepEqual(commitRange({ repository: repo, pull_request: { base: { sha: before, repo }, head: { sha: after } } }, 'pull_request', repo.full_name), { before, after });
  assert.equal(commitRange({ repository: repo, ref: 'refs/heads/topic', deleted: true, after: '0'.repeat(40) }, 'push', repo.full_name), null);
  for (const [payload, name] of [
    [{ repository: repo, ref: 'refs/heads/main', before: '0'.repeat(40), after }, 'push'],
    [{ repository: repo, ref: 'refs/tags/v1', before, after }, 'push'],
    [{ repository: repo, ref: 'refs/heads/main', before: 'main', after }, 'push'],
    [{ repository: { full_name: 'other/repo' }, ref: 'refs/heads/main', before, after }, 'push'],
    [{ repository: repo, pull_request: { base: { sha: before, repo }, head: { sha: after } } }, 'pull_request_target'],
  ]) assert.throws(() => commitRange(payload, name, repo.full_name));
});

test('reads a complete paginated comparison using immutable SHAs', async () => {
  const commits = Array.from({ length: 100 }, (_, index) => commit(index.toString(16).padStart(40, '0')));
  commits.push(commit(after));
  const calls = [];
  const api = { async get(path, query) {
    calls.push({ path, query });
    return response(commits.slice((query.page - 1) * 100, query.page * 100), 101);
  } };
  assert.deepEqual(await readCommits(api, { before, after }), commits);
  assert.deepEqual(calls.map((call) => call.query.page), [1, 2]);
  assert.ok(calls.every((call) => call.path === `/compare/${before}...${after}`));
  assert.deepEqual(inspectCommits(commits), []);
});

test('fails closed for limits, truncation, duplicates, missing messages, and wrong heads', async () => {
  const broken = [
    response([commit(after)], 251),
    response([commit(after)], 100),
    response([commit(after), commit(after)]),
    response([{ sha: after }]),
    response([commit('c'.repeat(40))]),
    { ...response([commit(after)]), base_commit: { sha: 'c'.repeat(40) } },
  ];
  for (const value of broken) await assert.rejects(readCommits({ async get() { return value; } }, { before, after }));
  await assert.rejects(readCommits({ async get() { throw new Error('API unavailable'); } }, { before, after }));
});

test('detects pagination metadata changes and reports fixed diagnostics without message interpolation', async () => {
  const first = Array.from({ length: 100 }, (_, index) => commit(index.toString(16).padStart(40, '0')));
  await assert.rejects(readCommits({ async get(_path, { page }) { return page === 1 ? response(first, 101) : response([commit(after)], 102); } }, { before, after }));
  const findings = inspectCommits([commit(after, '::error:: secret-like untrusted text')]);
  assert.equal(findings[0].sha, after);
  assert.equal(findings.some((finding) => finding.message.includes('secret-like')), false);
});
