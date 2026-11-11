import test from 'node:test';
import assert from 'node:assert/strict';
import { inventoryOptions, ownedRepositories } from '../inventory.mjs';

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

const orgRepo = { full_name: 'example-org/project', owner: { login: 'example-org', type: 'Organization' } };

test('organization mode selects only active repositories owned by the requested organization', async () => {
  const repos = await ownedRepositories(async (path) => {
    if (path === '/user') return { login: 'example' };
    assert.ok(path.startsWith('/orgs/Example-Org/repos?type=all&'));
    return [orgRepo, repository, { ...orgRepo, archived: true }, { ...orgRepo, disabled: true },
      { ...orgRepo, fork: true }, { ...orgRepo, owner: { login: 'other-org', type: 'Organization' } }];
  }, { organization: 'Example-Org' });
  assert.deepEqual(repos, [orgRepo]);
});

test('installation organization mode uses selected installation repositories and rejects the wrong account', async () => {
  const get = async (path) => {
    if (path === '/user') throw { status: 403 };
    assert.ok(path.startsWith('/installation/repositories?'));
    return { repositories: [orgRepo, repository] };
  };
  assert.deepEqual(await ownedRepositories(get, { organization: 'example-org' }), [orgRepo]);
  await assert.rejects(ownedRepositories(get, { organization: 'another-org' }));
});

test('organization inventory paginates and preserves organization filters', async () => {
  const repos = await ownedRepositories(async (path) => {
    if (path === '/user') return { login: 'example' };
    assert.ok(path.startsWith('/orgs/example-org/repos?type=all&'));
    return path.endsWith('page=1') ? Array(100).fill(orgRepo) : [orgRepo];
  }, { organization: 'example-org' });
  assert.equal(repos.length, 101);
});

test('CLI options require an explicit valid organization and reject accidental scope expansion', async () => {
  assert.deepEqual(inventoryOptions([]), {});
  assert.deepEqual(inventoryOptions(['--org', 'example-org']), { organization: 'example-org' });
  for (const args of [['example-org'], ['--org'], ['--org', '../other'], ['--all'], ['--org', 'example-org', 'extra']]) {
    assert.throws(() => inventoryOptions(args));
  }
  await assert.rejects(ownedRepositories(async () => assert.fail('Invalid scope requested'), { organization: '../other' }));
});

test('organization permission failures are reported, never converted into an empty successful inventory', async () => {
  await assert.rejects(ownedRepositories(async (path) => {
    if (path === '/user') return { login: 'example' };
    throw { status: 403 };
  }, { organization: 'example-org' }));
});
