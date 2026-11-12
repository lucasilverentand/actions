import test from 'node:test';
import assert from 'node:assert/strict';
import { inventoryOptions, ownedRepositories } from '../inventory.mjs';

const distinct = (items, offset = 0) => items.map((repo, index) => ({ ...repo, full_name: index + offset ? repo.full_name + '-' + (index + offset) : repo.full_name }));

const repository = { full_name: 'example/project', owner: { login: 'example', type: 'User' } };

test('personal token inventory includes owned active repositories only', async () => {
  const repos = await ownedRepositories(async (path) => path === '/user' ? { login: 'example' } : distinct([
    repository, { ...repository, archived: true }, { ...repository, fork: true },
    { ...repository, owner: { login: 'someone-else' } },
  ]));
  assert.deepEqual(repos, [repository]);
});

test('installation tokens use installation inventory and exclude organization repos', async () => {
  const repos = await ownedRepositories(async (path) => {
    if (path === '/user') throw { status: 403 };
    assert.ok(path.startsWith('/installation/repositories?'));
    return { repositories: distinct([repository, { ...repository, owner: { type: 'Organization' } }]) };
  });
  assert.deepEqual(repos, [repository]);
});

test('inventory paginates and does not hide authentication failures', async () => {
  const repos = await ownedRepositories(async (path) => {
    if (path === '/user') return { login: 'example' };
    return path.endsWith('page=1') ? distinct(Array(100).fill(repository)) : distinct([repository], 100);
  });
  assert.equal(repos.length, 101);
  await assert.rejects(ownedRepositories(async () => { throw { status: 401 }; }));
});

const orgRepo = { full_name: 'example-org/project', owner: { login: 'example-org', type: 'Organization' } };

test('organization mode selects only active repositories owned by the requested organization', async () => {
  const repos = await ownedRepositories(async (path) => {
    if (path === '/user') return { login: 'example' };
    assert.ok(path.startsWith('/orgs/Example-Org/repos?type=all&'));
    return distinct([orgRepo, repository, { ...orgRepo, archived: true }, { ...orgRepo, disabled: true },
      { ...orgRepo, fork: true }, { ...orgRepo, owner: { login: 'other-org', type: 'Organization' } }]);
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
    return path.endsWith('page=1') ? distinct(Array(100).fill(orgRepo)) : distinct([orgRepo], 100);
  }, { organization: 'example-org' });
  assert.equal(repos.length, 101);
});

test('CLI options require an explicit valid organization and reject accidental scope expansion', async () => {
  assert.deepEqual(inventoryOptions([]), {});
  assert.deepEqual(inventoryOptions(['--org', 'example-org']), { organization: 'example-org' });
  assert.deepEqual(inventoryOptions(['--org', 'example-org', '--concurrency', '3']), { organization: 'example-org', concurrency: 3 });
  assert.deepEqual(inventoryOptions(['--concurrency', '1']), { concurrency: 1 });
  for (const args of [['example-org'], ['--org'], ['--org', '../other'], ['--all'], ['--org', 'example-org', 'extra']]) {
    assert.throws(() => inventoryOptions(args));
  }
  await assert.rejects(ownedRepositories(async () => assert.fail('Invalid scope requested'), { organization: '../other' }));
  for (const args of [['--concurrency', '0'], ['--concurrency', '5'], ['--concurrency'], ['--org', 'first', '--org', 'second']]) {
    assert.throws(() => inventoryOptions(args));
  }
});

test('organization permission failures are reported, never converted into an empty successful inventory', async () => {
  await assert.rejects(ownedRepositories(async (path) => {
    if (path === '/user') return { login: 'example' };
    throw { status: 403 };
  }, { organization: 'example-org' }));
});

test('invalid account identities and incomplete installation counts never become a passing empty inventory', async () => {
  for (const identity of [{}, { login: '' }, { login: null }]) {
    await assert.rejects(ownedRepositories(async (path) => {
      assert.equal(path, '/user');
      return identity;
    }));
  }
  await assert.rejects(ownedRepositories(async (path) => {
    if (path === '/user') throw { status: 403 };
    return { total_count: 2, repositories: [repository] };
  }));
  await assert.rejects(ownedRepositories(async (path) => {
    if (path === '/user') throw { status: 403 };
    return { total_count: -1, repositories: [] };
  }));
  assert.deepEqual(await ownedRepositories(async (path) => {
    if (path === '/user') throw { status: 403 };
    return { total_count: 1, repositories: [repository] };
  }), [repository]);
});

test('installation discovery rejects a count that changes while paginating', async () => {
  await assert.rejects(ownedRepositories(async (path) => {
    if (path === '/user') throw { status: 403 };
    return path.endsWith('page=1') ? { total_count: 101, repositories: Array(100).fill(repository) }
      : { total_count: 102, repositories: [repository, repository] };
  }));
});


test('rejects wrong-scope installations and duplicate inventories even with consistent counts', async () => {
  await assert.rejects(ownedRepositories(async (path) => {
    if (path === '/user') throw { status: 403 };
    return { total_count: 1, repositories: [orgRepo] };
  }), /scope/);
  for (const entries of [[repository, repository], [{ ...repository, id: 1 }, { ...repository, id: 1, full_name: 'example/renamed' }]]) {
    await assert.rejects(ownedRepositories(async (path) => path === '/user' ? { login: 'example' } : entries), /Duplicate/);
  }
});

test('the usage message names every supported option', () => {
  assert.throws(() => inventoryOptions(['--all', 'yes']), (error) =>
    ['--org', '--concurrency', '--rules', '--trusted-owners'].every((flag) => error.message.includes(flag)));
});
