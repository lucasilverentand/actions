import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateJobs } from '../src/index.mjs';

test('requires every supplied job and records only result values', () => {
  assert.deepEqual(evaluateJobs({ build: { result: 'success', outputs: { secret: 'not-retained' } } }), {
    passed: true, results: { build: 'success' }, failures: [],
  });
  for (const result of ['failure', 'cancelled', 'skipped', undefined, 'pending']) {
    assert.equal(evaluateJobs({ build: { result } }).passed, false);
  }
});
test('empty, missing, malformed and extra failing dependencies cannot pass', () => {
  assert.equal(evaluateJobs({}).passed, false);
  assert.equal(evaluateJobs({ build: { result: 'success' } }, { required: ['test'] }).passed, false);
  assert.equal(evaluateJobs({ build: null }).passed, false);
  assert.equal(evaluateJobs({ build: { result: 'success' }, test: { result: 'failure' } }, { required: ['build'] }).passed, false);
  for (const input of [null, [], 'success']) assert.throws(() => evaluateJobs(input));
});
test('only explicitly named skips pass, never absent jobs or failed optional jobs', () => {
  assert.equal(evaluateJobs({ docs: { result: 'skipped' } }, { allowSkipped: ['docs'] }).passed, true);
  assert.equal(evaluateJobs({}, { required: ['docs'], allowSkipped: ['docs'] }).passed, false);
  assert.equal(evaluateJobs({ docs: { result: 'failure' } }, { allowSkipped: ['docs'] }).passed, false);
  assert.throws(() => evaluateJobs({ build: { result: 'success' } }, { allowSkipped: ['typo'] }));
});
test('rejects duplicate and malformed job policy, treats prototype names as ordinary own keys', () => {
  assert.throws(() => evaluateJobs({}, { required: ['test', 'test'] }));
  assert.throws(() => evaluateJobs({}, { required: ['test\ninjection'] }));
  const result = evaluateJobs(JSON.parse('{"__proto__":{"result":"failure"}}'));
  assert.equal(result.passed, false);
  assert.equal(Object.hasOwn(result.results, '__proto__'), true);
  assert.equal(evaluateJobs({}, { required: ['toString'] }).passed, false);
});
