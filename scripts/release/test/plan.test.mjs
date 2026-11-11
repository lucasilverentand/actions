import test from 'node:test';
import assert from 'node:assert/strict';
import { planRelease } from '../plan.mjs';
import { publishRelease } from '../publish.mjs';

const sha = 'a'.repeat(40);
const commit = (message, id = sha) => ({ sha: id, commit: { message } });

function fixture(options = {}) {
  const writes = [];
  let released = false;
  const api = { async request(method, path, body) {
    if (method === 'POST') {
      writes.push({ path, body });
      if (path === '/releases') released = true;
      return { html_url: 'https://github.com/example/actions/releases/tag/v1.2.0' };
    }
    if (!path) return { default_branch: 'main' };
    if (path.startsWith('/git/ref/heads/')) return { object: { sha } };
    if (path.startsWith('/releases?')) return released ? [{ tag_name: 'v1.2.0' }] : options.releases ?? [{ tag_name: 'v1.1.0' }];
    if (path.startsWith('/compare/')) {
      if (released || options.identical) return { status: 'identical', total_commits: 0, commits: [] };
      const commits = options.commits ?? [commit('feat: automate version selection')];
      if (options.pagination) {
        const page = new URL(`https://example.com${path}`).searchParams.get('page');
        return { status: 'ahead', total_commits: 101, commits: page === '1' ? commits.slice(0, 100) : commits.slice(100) };
      }
      return { status: options.status ?? 'ahead', total_commits: options.total ?? commits.length, commits };
    }
    if (path.startsWith('/commits?')) return [commit('feat: introduce repository actions')];
    throw Object.assign(new Error('404'), { status: 404 });
  } };
  return { api, writes };
}

test('automatically derives the next feature version and notes from commits, with no package version input', async () => {
  const { api, writes } = fixture();
  const plan = await planRelease(api, sha);
  assert.equal(plan.version, '1.2.0');
  assert.match(plan.notes, /feat: automate version selection/);
  assert.equal(writes.length, 0);
});

test('selects the greatest stable release numerically and ignores drafts and prereleases', async () => {
  const { api } = fixture({ releases: [
    { tag_name: 'v1.9.0' }, { tag_name: 'v1.10.0' },
    { tag_name: 'v9.0.0', draft: true }, { tag_name: 'v8.0.0', prerelease: true },
  ], commits: [commit('fix: handle empty documents')] });
  assert.equal((await planRelease(api, sha)).version, '1.10.1');
});

test('bootstraps at 1.0.0 and performs no work when the head is already released', async () => {
  assert.equal((await planRelease(fixture({ releases: [] }).api, sha)).version, '1.0.0');
  assert.equal(await planRelease(fixture({ identical: true }).api, sha), null);
});

test('fails on divergent history, truncated inventories, duplicate commits, and unclassified commits', async () => {
  for (const options of [
    { status: 'diverged' }, { status: 'behind' }, { total: 2 },
    { commits: [commit('fix: repair input'), commit('fix: repair output')] },
    { commits: [commit('An unclassified merge')] },
  ]) await assert.rejects(planRelease(fixture(options).api, sha));
});

test('includes every page of commits and uses a feature on a later page to select the version', async () => {
  const commits = Array.from({ length: 101 }, (_, index) => commit(
    index === 100 ? 'feat: add another action' : 'fix: improve behavior', index.toString(16).padStart(40, '0')));
  const { api } = fixture({ commits, pagination: true });
  const plan = await planRelease(api, sha);
  assert.equal(plan.version, '1.2.0');
  assert.equal(plan.notes.split('\n').filter((line) => line.startsWith('- ')).length, 101);
});

test('commit text is inert data and HTML is escaped in release notes', async () => {
  const { api } = fixture({ commits: [commit('fix: handle <script>$(touch /tmp/never-created)</script> input')] });
  const plan = await planRelease(api, sha);
  assert.match(plan.notes, /&lt;script&gt;/);
  assert.doesNotMatch(plan.notes, /<script>/);
});

test('a verified merge plans and publishes once; rerunning the entire flow creates no additional version', async () => {
  const { api, writes } = fixture();
  const plan = await planRelease(api, sha);
  const result = await publishRelease(api, plan, { sha, ref: 'refs/heads/main', event: 'push' });
  assert.equal(result.created, true);
  assert.equal(writes[0].body.ref, 'refs/tags/v1.2.0');
  assert.equal(await planRelease(api, sha), null);
  assert.equal(writes.length, 2);
});
