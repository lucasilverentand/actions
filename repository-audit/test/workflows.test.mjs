import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectWorkflow, trustedPullRequestGate } from '../src/workflows.mjs';

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
  for (const value of ['0', '-5', "'10'"]) {
    assert.ok(rules(safe.replace('timeout-minutes: 10', `timeout-minutes: ${value}`)).includes('workflow-timeout'), value);
  }
  // Long native builds, archives and uploads keep an explicit bound without a short policy cap.
  for (const value of ['61', '180', '720']) {
    assert.deepEqual(rules(safe.replace('timeout-minutes: 10', `timeout-minutes: ${value}`)), [], value);
  }
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

test('requires triggers, nonempty job maps, executable steps, and valid permissions', () => {
  for (const value of [
    safe.replace('on: pull_request\n', ''),
    'on: push\npermissions: {}\njobs: []',
    'on: push\npermissions: {}\njobs: {}',
    safe.replace('    steps:\n', '    steps: invalid\n    ignored:\n'),
    safe.replace('      - run: echo "$TITLE"', '      - run: 42'),
    safe.replace('      - run: echo "$TITLE"', '      - name: missing-operation'),
  ]) assert.ok(rules(value).includes('workflow-parse'), value);
  for (const value of ['null', '[]', 'read', '{contents: admin}', '{made-up-scope: read}', '{id-token: read}', '{models: write}']) {
    assert.ok(rules(safe.replace('{contents: read}', value)).includes('workflow-permissions'), value);
  }
  assert.deepEqual(rules(safe.replace('{contents: read}', 'read-all')), []);
});

test('checks job and service container digests', () => {
  const withContainers = safe.replace('    steps:', `    container: node@sha256:${'b'.repeat(64)}\n    services:\n      database:\n        image: postgres@sha256:${'c'.repeat(64)}\n    steps:`);
  assert.deepEqual(rules(withContainers), []);
  assert.ok(rules(withContainers.replace(`postgres@sha256:${'c'.repeat(64)}`, 'postgres:17')).includes('workflow-container-pin'));
  assert.ok(rules(withContainers.replace(`node@sha256:${'b'.repeat(64)}`, 'node:24')).includes('workflow-container-pin'));
});

test('detects bracket-notation and case-insensitive event/input script interpolation', () => {
  for (const expression of ["github['event']['pull_request']['title']", "inputs['command']", "inputs['command-line']", "GITHUB.event.pull_request.title", "github [ 'head_ref' ]"]) {
    const value = safe.replace('echo "$TITLE"', `echo "\u0024{{ ${expression} }}"`);
    assert.ok(rules(value).includes('workflow-injection'), expression);
  }
  assert.ok(rules(safe.replace('actions/checkout', 'Actions/Checkout').replace('persist-credentials: false', 'persist-credentials: true')).includes('workflow-checkout-credentials'));
  for (const expression of ['github.event_name', 'github.event_path']) {
    assert.equal(rules(safe.replace('echo "$TITLE"', `echo "\u0024{{ ${expression} }}"`)).includes('workflow-injection'), false);
  }
});

test('allows only narrow same-repository guards for self-hosted PR runners', () => {
  const equality = 'github.event.pull_request.head.repo.full_name == github.repository';
  const guarded = safe.replace('ubuntu-latest', 'self-hosted').replace('    runs-on:', `    if: ${equality}\n    runs-on:`);
  assert.equal(rules(guarded).includes('workflow-runner'), false);
  assert.equal(rules(guarded.replace(equality, `github.event_name != 'pull_request' || ${equality}`)).includes('workflow-runner'), false);
  assert.equal(trustedPullRequestGate(`\u0024{{ ${equality} }}`, ['pull_request']), true);
  for (const gate of [`${equality} || true`, 'true', `github.event_name != 'pull_request' || ${equality}`]) {
    assert.equal(trustedPullRequestGate(gate, ['pull_request_target']), false, gate);
  }
  assert.equal(trustedPullRequestGate(equality, ['pull_request_target']), true);
});

test('trusted owners permit branch and tag references only in valid external references', () => {
  const workflow = (uses) => `on: push\npermissions: {}\njobs:\n  check:\n    runs-on: ubuntu-latest\n    timeout-minutes: 5\n    steps:\n      - uses: ${uses}\n`;
  const pinned = (uses, owners = []) => inspectWorkflow(workflow(uses), 'ci.yml', { trustedOwners: owners }).some((f) => f.rule === 'workflow-pin');
  for (const ref of ['example-org/tools/.github/workflows/check.yml@main', 'example-org/action@v1']) {
    assert.equal(pinned(ref), true);
    assert.equal(pinned(ref, ['EXAMPLE-ORG']), false);
  }
  for (const ref of ['other/action@main', 'example-org/action@', '"example-org/action@bad ref"', 'docker://example-org/action:latest']) assert.equal(pinned(ref, ['example-org']), true);
});
