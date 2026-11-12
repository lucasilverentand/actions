import test from 'node:test';
import assert from 'node:assert/strict';
import { GitHub } from '../github.mjs';

test('API pagination consumes all pages and preserves query filters', async () => {
  const urls = [];
  const api = new GitHub('test-token', 'example/project', async (url) => {
    urls.push(url);
    return { ok: true, status: 200, json: async () => urls.length === 1 ? Array(100).fill({}) : [{}] };
  });
  assert.equal((await api.list('/pulls', { state: 'open' })).length, 101);
  assert.equal(urls[1].searchParams.get('state'), 'open');
  assert.equal(urls[1].searchParams.get('page'), '2');
});
test('API does not expose response bodies, follow redirects, or accept invalid repo paths', async () => {
  const api = new GitHub('test-token', 'example/project', async (url, options) => {
    assert.equal(options.redirect, 'error');
    return { ok: false, status: 403, text: async () => 'sensitive response' };
  });
  await assert.rejects(api.get(''), { message: 'GitHub API returned 403.' });
  assert.throws(() => new GitHub('test-token', '../other?token=bad'));
});
test('merge settings come from GraphQL and missing data is an error, not a disabled setting', async () => {
  let request;
  const data = { deleteBranchOnMerge: true, mergeCommitAllowed: false, squashMergeAllowed: true, rebaseMergeAllowed: false,
    squashMergeCommitTitle: 'PR_TITLE', squashMergeCommitMessage: 'PR_BODY' };
  const api = (repository) => new GitHub('test-token', 'example/project', async (url, options) => {
    request = { url: String(url), options };
    return { ok: true, status: 200, json: async () => ({ data: { repository } }) };
  });
  assert.deepEqual(await api(data).mergeSettings(), { delete_branch_on_merge: true, allow_merge_commit: false, allow_squash_merge: true,
    allow_rebase_merge: false, squash_merge_commit_title: 'PR_TITLE', squash_merge_commit_message: 'PR_BODY' });
  assert.equal(request.url, 'https://api.github.com/graphql');
  assert.equal(request.options.redirect, 'error');
  assert.deepEqual(JSON.parse(request.options.body).variables, { owner: 'example', name: 'project' });
  await assert.rejects(api(null).mergeSettings(), { message: 'Merge settings are unavailable.' });
});
