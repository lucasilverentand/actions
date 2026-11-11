import test from 'node:test';
import assert from 'node:assert/strict';
import { publishRelease } from '../publish.mjs';

const sha = 'a'.repeat(40);
const metadata = { version: '1.3.0', tag: 'v1.3.0', notes: '- Add reviewed release automation and version tracking.' };
const context = { event: 'push', ref: 'refs/heads/main', sha };

function fixture(options = {}) {
  let headReads = 0;
  const writes = [];
  const api = { async request(method, path, body) {
    if (method === 'POST') {
      writes.push({ path, body });
      return path === '/releases' ? { html_url: 'https://github.com/example/actions/releases/tag/v1.3.0' } : {};
    }
    if (options.fail === path) throw Object.assign(new Error('403'), { status: 403 });
    if (!path) return { default_branch: 'main' };
    if (path.startsWith('/git/ref/heads/')) {
      headReads++;
      return { object: { sha: options.moved || (options.movedLater && headReads > 1) ? 'b'.repeat(40) : sha } };
    }
    if (path.startsWith('/releases?')) return options.releases ?? [{ tag_name: 'v1.2.3' }];
    if (path.startsWith('/releases/tags/') && options.existing) return options.existing;
    if (path.startsWith('/git/ref/tags/') && options.tag) return { object: options.tag };
    if (path.startsWith('/git/tags/') && options.annotated) return { object: { type: 'commit', sha } };
    throw Object.assign(new Error('404'), { status: 404 });
  } };
  return { api, writes };
}

test('publishes the exact verified commit and reviewed notes without moving existing refs', async () => {
  const { api, writes } = fixture();
  const result = await publishRelease(api, metadata, context);
  assert.equal(result.created, true);
  assert.deepEqual(writes[0], { path: '/git/refs', body: { ref: 'refs/tags/v1.3.0', sha } });
  assert.equal(writes[1].body.target_commitish, sha);
  assert.equal(writes[1].body.body, metadata.notes);
  assert.equal(writes[1].body.draft, false);
});

test('repeated runs leave published releases untouched', async () => {
  const { api, writes } = fixture({ existing: { html_url: 'existing' }, tag: { type: 'commit', sha } });
  assert.equal((await publishRelease(api, metadata, context)).created, false);
  assert.equal(writes.length, 0);
});

test('rejects PRs, non-default branches, and default branch advances without mutations', async () => {
  for (const change of [{ event: 'pull_request' }, { ref: 'refs/heads/feature' }]) {
    const { api, writes } = fixture();
    await assert.rejects(publishRelease(api, metadata, { ...context, ...change }));
    assert.equal(writes.length, 0);
  }
  for (const change of [{ moved: true }, { movedLater: true }]) {
    const { api, writes } = fixture(change);
    await assert.rejects(publishRelease(api, metadata, context));
    assert.equal(writes.length, 0);
  }
});

test('refuses rollback even when that old version has an existing release', async () => {
  const { api, writes } = fixture({ existing: { html_url: 'old' }, releases: [{ tag_name: 'v2.0.0' }] });
  await assert.rejects(publishRelease(api, metadata, context));
  assert.equal(writes.length, 0);
});

test('refuses tag conflicts and unfinished releases', async () => {
  for (const options of [{ tag: { type: 'commit', sha: 'b'.repeat(40) } }, { existing: { draft: true } }]) {
    const { api, writes } = fixture(options);
    await assert.rejects(publishRelease(api, metadata, context));
    assert.equal(writes.length, 0);
  }
});

test('can resume a failed publication only when the existing tag matches the verified commit', async () => {
  for (const options of [{ tag: { type: 'commit', sha } }, { tag: { type: 'tag', sha: 'c'.repeat(40) }, annotated: true }]) {
    const { api, writes } = fixture(options);
    assert.equal((await publishRelease(api, metadata, context)).created, true);
    assert.deepEqual(writes.map((w) => w.path), ['/releases']);
  }
});

test('API permission failures stop publication before tag creation', async () => {
  const { api, writes } = fixture({ fail: '/releases?per_page=100&page=1' });
  await assert.rejects(publishRelease(api, metadata, context));
  assert.equal(writes.length, 0);
});

test('existing releases must still have their exact verified tag, never silently accept a different commit', async () => {
  for (const tag of [undefined, { type: 'commit', sha: 'b'.repeat(40) }]) {
    const { api, writes } = fixture({ existing: { html_url: 'existing' }, tag });
    await assert.rejects(publishRelease(api, metadata, context));
    assert.equal(writes.length, 0);
  }
});
