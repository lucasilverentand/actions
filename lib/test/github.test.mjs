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
