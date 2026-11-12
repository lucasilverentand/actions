import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectWorkflows } from '../src/index.mjs';
import { ApiError } from '../../lib/github.mjs';

const head = 'a'.repeat(40);
const base = 'b'.repeat(40);
const other = 'c'.repeat(40);
const ancestor = 'd'.repeat(40);
const path = '.github/workflows/ci.yml';
const source = 'on: pull_request\npermissions: {}\njobs:\n  check:\n    runs-on: ubuntu-latest\n    timeout-minutes: 10\n    steps:\n      - run: echo ok\n';
const context = { eventName: 'pull_request', payload: { number: 42, pull_request: { base: { sha: base }, head: { sha: head } } } };

function fixture(overrides = {}) {
  const calls = [];
  const files = overrides.files ?? [{ filename: path, status: 'modified' }];
  const entry = (path, sha) => ({ path, name: path.split('/').at(-1), sha, type: 'file' });
  const isWorkflow = (path) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(path ?? '');
  const original = files.flatMap((file) => {
    const oldPath = file.previous_filename ?? file.filename;
    return file.status !== 'added' && isWorkflow(oldPath) ? [entry(oldPath, file.status === 'unchanged' ? head : other)] : [];
  });
  const proposed = files.filter((file) => file.status !== 'removed' && isWorkflow(file.filename)).map((file) => entry(file.filename, head));
  const api = {
    calls,
    async get(route, query) {
      calls.push({ route, query });
      if (overrides.fail === route) throw new ApiError(403);
      if (route === '') return { default_branch: 'main' };
      if (route === '/commits/main') return { sha: head };
      if (route === `/compare/${base}...${head}`) return overrides.comparison ?? {
        base_commit: { sha: base }, merge_base_commit: { sha: ancestor }, files: [{ filename: 'unrelated.txt' }],
      };
      if (route === '/contents/.github/workflows') {
        if (overrides.missing) throw new ApiError(404);
        return overrides.entries ?? (query.ref === ancestor ? original : proposed);
      }
      throw new Error(`Unexpected route ${route}`);
    },
    async list() { assert.fail('Mutable PR file lists must never be read.'); },
    async file(filePath, ref) {
      calls.push({ filePath, ref });
      if (overrides.fileFailure) throw new ApiError(403);
      return overrides.source ?? source;
    },
  };
  return api;
}

const unverified = (result) => result.findings.some((finding) => finding.rule === 'workflow-inspection' && finding.level === 'error');

test('inspects only changed workflows at the immutable PR head', async () => {
  const api = fixture({ files: [{ filename: 'src/app.mjs', status: 'modified' }, { filename: path, status: 'modified' }] });
  const result = await inspectWorkflows(api, context);
  assert.deepEqual(result.findings, []);
  assert.equal(result.inspectedSha, head);
  assert.equal(result.inspectedCount, 1);
  assert.deepEqual(api.calls.filter((call) => call.filePath), [{ filePath: path, ref: head }]);
  assert.equal(api.calls.some((call) => call.route?.startsWith('/pulls/')), false);
});

test('supports trusted-base pull_request_target inspection without checkout', async () => {
  assert.deepEqual((await inspectWorkflows(fixture(), { ...context, eventName: 'pull_request_target' })).findings, []);
});

test('missing or invalid payload SHAs are unverified before API requests', async () => {
  for (const pull_request of [{ head: { sha: head } }, { base: { sha: base } },
    { base: { sha: 'invalid' }, head: { sha: head } }, { base: { sha: base }, head: { sha: 'invalid' } }]) {
    const api = fixture();
    assert.equal(unverified(await inspectWorkflows(api, { eventName: 'pull_request', payload: { pull_request } })), true);
    assert.deepEqual(api.calls, []);
  }
});

test('rejects incomplete, duplicate, capped, or malformed immutable workflow directories', async () => {
  for (const overrides of [
    { entries: Array(1000).fill({ path }) },
    { entries: [{ path, name: 'ci.yml', type: 'file', sha: 'invalid' }] },
    { entries: [{ path, name: 'ci.yml', type: 'symlink', sha: other }] },
    { files: [{ filename: path, status: 'modified' }, { filename: path, status: 'modified' }] },
    { comparison: { base_commit: { sha: other }, merge_base_commit: { sha: ancestor } } },
    { comparison: { base_commit: { sha: base }, merge_base_commit: { sha: 'invalid' } } },
  ]) assert.equal(unverified(await inspectWorkflows(fixture(overrides), context)), true);
});

test('immutable directory diff survives an ABA PR change and ignores mutable/capped file lists', async () => {
  const api = fixture({ source: source.replace('permissions: {}', 'permissions: write-all') });
  let mutableReads = 0;
  api.list = async () => { mutableReads++; return [{ filename: 'innocent.txt', status: 'modified' }]; };
  const result = await inspectWorkflows(api, context);
  assert.equal(mutableReads, 0);
  assert.equal(result.inspectedCount, 1);
  assert.ok(result.findings.some((finding) => finding.rule === 'workflow-write-all'));
  assert.deepEqual(api.calls.filter((call) => call.route === '/contents/.github/workflows').map((call) => call.query.ref), [ancestor, head]);
});

test('unchanged workflow blobs are skipped, regardless of unrelated PR changes', async () => {
  const result = await inspectWorkflows(fixture({ files: [{ filename: path, status: 'unchanged' }] }), context);
  assert.deepEqual(result.findings, []);
  assert.equal(result.inspectedCount, 0);
});

test('malformed PR metadata and denied file access never pass silently', async () => {
  assert.equal(unverified(await inspectWorkflows(fixture(), { eventName: 'pull_request' })), true);
  assert.equal(unverified(await inspectWorkflows(fixture({ fileFailure: true }), context)), true);
});

test('renamed-in workflows are inspected; removed and renamed-out workflows are reported', async () => {
  const api = fixture({ files: [
    { filename: path, previous_filename: 'example.yml', status: 'renamed' },
    { filename: '.github/workflows/old.yml', status: 'removed' },
    { filename: 'disabled.yml', previous_filename: '.github/workflows/disabled.yml', status: 'renamed' },
  ] });
  const result = await inspectWorkflows(api, context);
  assert.equal(result.inspectedCount, 1);
  assert.equal(result.findings.filter((finding) => finding.rule === 'workflow-removed' && finding.level === 'warning').length, 2);
});

test('malformed or unsafe workflow contents are findings, not executed code', async () => {
  for (const unsafe of ['jobs: [', source.replace('permissions: {}', 'permissions: write-all')]) {
    const result = await inspectWorkflows(fixture({ source: unsafe }), context);
    assert.equal(result.findings.some((finding) => finding.level === 'error'), true);
    assert.equal(result.inspectedCount, 1);
  }
});

test('scheduled and manual inspections pin the directory and files to one commit', async () => {
  for (const eventName of ['schedule', 'workflow_dispatch']) {
    const api = fixture();
    const result = await inspectWorkflows(api, { eventName });
    assert.deepEqual(result.findings, []);
    assert.equal(result.inspectedSha, head);
    assert.deepEqual(api.calls.find((call) => call.route === '/contents/.github/workflows').query, { ref: head });
    assert.equal(api.calls.find((call) => call.filePath).ref, head);
  }
});

test('missing workflows are a warning; directory truncation and denied access are unverified', async () => {
  const absent = await inspectWorkflows(fixture({ missing: true }), { eventName: 'schedule' });
  assert.equal(absent.findings[0].level, 'warning');
  for (const overrides of [{ entries: Array(1000).fill({ path }) }, { fail: '/contents/.github/workflows' }]) {
    assert.equal(unverified(await inspectWorkflows(fixture(overrides), { eventName: 'schedule' })), true);
  }
});

test('unsupported events are rejected', async () => {
  await assert.rejects(inspectWorkflows(fixture(), { eventName: 'push' }));
});

test('workflow reads are bounded to four and findings preserve input order despite out-of-order responses', async () => {
  const files = Array.from({ length: 9 }, (_, index) => ({ filename: `.github/workflows/job-${index}.yml`, status: 'modified' }));
  const api = fixture({ files });
  let active = 0;
  let maximum = 0;
  api.file = async (filename, ref) => {
    assert.equal(ref, head);
    active++;
    maximum = Math.max(maximum, active);
    const index = Number(filename.match(/job-(\d+)/)[1]);
    await new Promise((resolve) => setTimeout(resolve, index % 2 ? 1 : 8));
    active--;
    return source.replace('permissions: {}', 'permissions: write-all');
  };
  const result = await inspectWorkflows(api, context);
  assert.equal(maximum, 4);
  assert.equal(active, 0);
  assert.equal(result.inspectedCount, files.length);
  assert.deepEqual(result.findings.map((finding) => finding.path), files.map((file) => file.filename));
});
