import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, lstat, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { auditFleet, inventoryReader, privateController, reportCounts, writePrivateReport } from '../core.mjs';

const repo = { full_name: 'example/one', owner: { login: 'example', type: 'User' } };
const getInventory = async (path) => path === '/user' ? { login: 'example' }
  : [repo, { ...repo, full_name: 'example/two' }];

test('fleet completes accessible inspections and records failures without response content', async () => {
  const report = await auditFleet(getInventory, {}, async (name) => {
    if (name === 'example/one') throw new Error('sensitive API body');
    return [{ level: 'warning', rule: 'description', message: 'Add a description.' }];
  });
  assert.deepEqual(report.scope, { personal: true });
  assert.deepEqual(reportCounts(report), { repositories: 2, failing: 1, errors: 1 });
  assert.equal(report.repositories[0].findings[0].rule, 'inspection');
  assert.doesNotMatch(JSON.stringify(report), /sensitive API body/);
});

test('failed discovery rejects the whole report before starting repository inspection', async () => {
  await assert.rejects(auditFleet(async () => { throw new Error('unavailable'); }, {}, () => assert.fail('Partial inspection')));
});

test('controller checks require an explicit private result and propagate inaccessible inspection', async () => {
  for (const metadata of [{ private: false }, {}, { visibility: 'private' }, { private: true, visibility: 'internal' }, { private: true }]) {
    await assert.rejects(privateController(async () => metadata, 'example/controller'));
  }
  await assert.rejects(privateController(async () => { throw new Error('403'); }, 'example/controller'));
  await assert.rejects(privateController(async () => assert.fail('Invalid request'), '../../other'));
  assert.deepEqual(await privateController(async () => ({ private: true, visibility: 'private' }), 'example/controller'), { private: true, visibility: 'private' });
});

test('inventory reader keeps credentials on the fixed API origin and suppresses error bodies', async () => {
  const reader = inventoryReader('private-token', async (url, request) => {
    assert.equal(url, 'https://api.github.com/user');
    assert.equal(request.redirect, 'error');
    assert.equal(request.headers.authorization, 'Bearer private-token');
    return { ok: false, status: 403, json: () => assert.fail('Read sensitive body') };
  });
  await assert.rejects(reader('/user'), (error) => error.status === 403 && !error.message.includes('private-token'));
  await assert.rejects(reader('//untrusted.example'));
  assert.throws(() => inventoryReader(''));
});

test('private reports atomically replace files and enforce POSIX permissions', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'fleet-core-'));
  const directory = join(temporary, 'reports');
  try {
    const report = { repositories: [] };
    const destination = await writePrivateReport(directory, report);
    await chmod(directory, 0o755);
    await chmod(destination, 0o644);
    await writePrivateReport(directory, report);
    assert.deepEqual(JSON.parse(await readFile(destination, 'utf8')), report);
    if (process.platform !== 'win32') {
      assert.equal((await stat(directory)).mode & 0o777, 0o700);
      assert.equal((await stat(destination)).mode & 0o777, 0o600);
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test('private reports never follow file or directory symlinks', { skip: process.platform === 'win32' && 'Creating file symlinks requires extra Windows privileges.' }, async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'fleet-symlink-'));
  const directory = join(temporary, 'reports');
  try {
    const report = { repositories: [] };
    const destination = await writePrivateReport(directory, report);
    const other = join(temporary, 'other');
    await writeFile(other, 'untouched');
    await rm(destination);
    await symlink(other, destination);
    await writePrivateReport(directory, report);
    assert.equal(await readFile(other, 'utf8'), 'untouched');
    assert.equal((await lstat(destination)).isSymbolicLink(), false);
    assert.deepEqual(JSON.parse(await readFile(destination, 'utf8')), report);
    await symlink(directory, join(temporary, 'alias'));
    await assert.rejects(writePrivateReport(join(temporary, 'alias'), report));
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
