import test from 'node:test';
import assert from 'node:assert/strict';
import { runRelease } from '../src/index.mjs';

const sha = 'a'.repeat(40);
const context = { event: 'push', ref: 'refs/heads/main', sha };
function fixture(options = {}) {
  const writes = [];
  return { writes, api: { async request(method, path, body) {
    if (method === 'POST') { writes.push({ path, body }); return { html_url: 'https://github.com/example/project/releases/tag/v1.0.0' }; }
    if (!path) return { default_branch: 'main', ...options.repo };
    if (path.startsWith('/git/ref/heads/')) return { object: { sha: options.head ?? sha } };
    if (path.startsWith('/releases?')) return options.released ? [{ tag_name: 'v1.0.0' }] : [];
    if (path.startsWith('/commits/v')) return { sha };
    if (path.endsWith('?per_page=1')) return { status: options.headStatus ?? 'diverged' };
    if (path.startsWith('/compare/')) return { status: 'identical', total_commits: 0, commits: [] };
    if (path.startsWith('/commits?')) return [{ sha, commit: { message: 'feat: introduce reusable automation' } }];
    throw Object.assign(new Error('Not found'), { status: 404 });
  } } };
}
test('default preview computes initial version without any mutations', async () => {
  const { api, writes } = fixture();
  const result = await runRelease(api, context, { initialVersion: '0.1.0' });
  assert.equal(result.tag, 'v0.1.0');
  assert.equal(result.created, false);
  assert.equal(result.planned, true);
  assert.deepEqual(writes, []);
});
test('publication requires successful nonempty upstream jobs', async () => {
  for (const needs of [{}, { verify: { result: 'skipped' } }, { verify: { result: 'cancelled' } }, { verify: { result: 'failure' } }]) {
    const { api, writes } = fixture();
    await assert.rejects(runRelease(api, context, { dryRun: false, needs }));
    assert.deepEqual(writes, []);
  }
  const { api, writes } = fixture();
  const result = await runRelease(api, context, { dryRun: false, needs: { verify: { result: 'success' } } });
  assert.equal(result.created, true);
  assert.deepEqual(writes.map((w) => w.path), ['/git/refs', '/releases']);
});
test('refuses untrusted events, stale runs, non-default branches, forks and archived repositories', async () => {
  for (const change of [{ event: 'pull_request' }, { event: 'pull_request_target' }, { ref: 'refs/heads/feature' }, { sha: 'main' }]) {
    await assert.rejects(runRelease(fixture().api, { ...context, ...change }));
  }
  for (const options of [{ head: 'b'.repeat(40) }, { repo: { fork: true } }, { repo: { archived: true } }]) {
    const { api, writes } = fixture(options);
    await assert.rejects(runRelease(api, context));
    assert.deepEqual(writes, []);
  }
});
test('already released commits are an explicit no-op and malformed initial versions fail', async () => {
  assert.equal((await runRelease(fixture({ released: true }).api, context)).planned, false);
  await assert.rejects(runRelease(fixture().api, context, { initialVersion: 'v1.0.0' }));
});

test('a run overtaken by a newer descendant succeeds as superseded without planning or writing', async () => {
  for (const dryRun of [true, false]) {
    const { api, writes } = fixture({ head: 'b'.repeat(40), headStatus: 'ahead' });
    const result = await runRelease(api, context, { dryRun, needs: { verify: { result: 'success' } } });
    assert.equal(result.superseded, true);
    assert.equal(result.planned, false);
    assert.equal(result.created, false);
    assert.equal(result.tag, '');
    assert.deepEqual(writes, []);
  }
  // Rewritten or unrelated history is not treated as superseded.
  for (const headStatus of ['diverged', 'behind', 'identical']) {
    const { api, writes } = fixture({ head: 'b'.repeat(40), headStatus });
    await assert.rejects(runRelease(api, context, { dryRun: false, needs: { verify: { result: 'success' } } }));
    assert.deepEqual(writes, []);
  }
});
