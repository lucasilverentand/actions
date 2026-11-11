import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRun } from '../src/index.mjs';

const environment = {
  GITHUB_EVENT_NAME: 'schedule', GITHUB_REPOSITORY: 'example/controller', GITHUB_REF: 'refs/heads/main',
};
const controller = { private: true, visibility: 'private', default_branch: 'main' };

test('fleet action permits scheduled and manually dispatched private default-branch runs', async () => {
  for (const GITHUB_EVENT_NAME of ['schedule', 'workflow_dispatch']) {
    await validateRun(async (path) => {
      assert.equal(path, '/repos/example/controller');
      return controller;
    }, { ...environment, GITHUB_EVENT_NAME });
  }
});

test('fleet action refuses PR, push and privileged events before sending a request', async () => {
  for (const GITHUB_EVENT_NAME of ['pull_request', 'pull_request_target', 'workflow_run', 'push', undefined]) {
    await assert.rejects(validateRun(() => assert.fail('API call before event validation'), { ...environment, GITHUB_EVENT_NAME }));
  }
});

test('fleet action refuses public, inaccessible, nondefault and missing-ref controllers', async () => {
  for (const metadata of [{ ...controller, private: false }, { ...controller, visibility: 'internal' }, { default_branch: 'main' }, { private: true }]) {
    await assert.rejects(validateRun(async () => metadata, environment));
  }
  for (const GITHUB_REF of ['refs/heads/topic', undefined, 'refs/pull/1/merge']) {
    await assert.rejects(validateRun(async () => controller, { ...environment, GITHUB_REF }));
  }
  await assert.rejects(validateRun(async () => { throw new Error('403'); }, environment));
});
