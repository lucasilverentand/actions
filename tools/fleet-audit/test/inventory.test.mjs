import test from 'node:test';
import assert from 'node:assert/strict';
import { ownedRepositories } from '../inventory.mjs';

const repository = { full_name: 'example/project', owner: { login: 'example', type: 'User' } };

test('personal token inventory includes owned active repositories only', async () => {
  const repos = await ownedRepositories(async (path) => path === '/user' ? { login: 'example' } : [
    repository, { ...repository, archived: true }, { ...repository, fork: true },
    { ...repository, owner: { login: 'someone-else' } },
  ]);
  assert.deepEqual(repos, [repository]);
});

test('installation tokens use installation inventory and exclude organization repos', async () => {
  const repos = await ownedRepositories(async (path) => {
    if (path === '/user') throw { status: 403 };
    assert.ok(path.startsWith('/installation/repositories?'));
    return { repositories: [repository, { ...repository, owner: { type: 'Organization' } }] };
  });
  assert.deepEqual(repos, [repository]);
});

test('inventory paginates and does not hide authentication failures', async () => {
  const repos = await ownedRepositories(async (path) => {
    if (path === '/user') return { login: 'example' };
    return path.endsWith('page=1') ? Array(100).fill(repository) : [repository];
  });
  assert.equal(repos.length, 101);
  await assert.rejects(ownedRepositories(async () => { throw { status: 401 }; }));
});
