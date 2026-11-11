import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectWorkflow } from '../src/workflows.mjs';

const sha = 'a'.repeat(40);
const safe = `name: Test\non: pull_request\npermissions: {contents: read}\njobs:\n  test:\n    runs-on: ubuntu-latest\n    timeout-minutes: 10\n    steps:\n      - uses: actions/checkout@${sha}\n        with:\n          persist-credentials: false\n      - run: echo "$TITLE"\n        env:\n          TITLE: \u0024{{ github.event.pull_request.title }}\n`;
const rules = (text) => inspectWorkflow(text, '.github/workflows/test.yml').map((f) => f.rule);

test('accepts pinned dependencies, scoped permissions, and event data in env', () => {
  assert.deepEqual(rules(safe), []);
});
test('finds floating actions and persisted checkout credentials', () => {
  assert.ok(rules(safe.replace(sha, 'v7')).includes('workflow-pin'));
  assert.ok(rules(safe.replace('persist-credentials: false', 'persist-credentials: true')).includes('workflow-checkout-credentials'));
});
test('finds direct expression injection into shell and github-script', () => {
  assert.ok(rules(safe.replace('echo "$TITLE"', 'echo "\u0024{{ github.event.pull_request.title }}"')).includes('workflow-injection'));
  assert.ok(rules(`${safe}      - uses: actions/github-script@${sha}\n        with:\n          script: console.log('\u0024{{ inputs.title }}')\n`).includes('workflow-injection'));
});
test('flags privileged checkout, self hosted PR jobs, broad token rights, and missing timeouts', () => {
  assert.ok(rules(safe.replace('on: pull_request', 'on: pull_request_target')).includes('workflow-privileged-checkout'));
  assert.ok(rules(safe.replace('ubuntu-latest', 'self-hosted')).includes('workflow-runner'));
  assert.ok(rules(safe.replace('{contents: read}', 'write-all')).includes('workflow-write-all'));
  assert.ok(rules(safe.replace('    timeout-minutes: 10\n', '')).includes('workflow-timeout'));
});
test('rejects invalid YAML, duplicate keys, and malformed workflow structures', () => {
  for (const value of ['jobs: [', 'jobs: {}\njobs: {}', '42', 'jobs: {test: null}']) {
    assert.ok(rules(value).includes('workflow-parse'));
  }
});
test('does not execute custom YAML tags or excessive aliases', () => {
  const value = `on: push\npermissions: {}\njobs: !!js/function 'function () { throw new Error(); }'`;
  // The parser never evaluates JavaScript; unfamiliar workflow structure fails inspection.
  assert.ok(rules(value).includes('workflow-parse'));
});
