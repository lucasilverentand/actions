import test from 'node:test';
import assert from 'node:assert/strict';
import { mapConcurrent } from '../concurrency.mjs';

test('bounded mapping preserves input order despite completion order', async () => {
  let running = 0;
  let peak = 0;
  const release = [];
  const result = mapConcurrent([0, 1, 2, 3], 2, async (value) => {
    running++;
    peak = Math.max(peak, running);
    await new Promise((resolve) => { release[value] = resolve; });
    running--;
    return value * 2;
  });
  assert.equal(peak, 2);
  release[1]();
  await new Promise(setImmediate);
  release[2]();
  await new Promise(setImmediate);
  release[3]();
  release[0]();
  assert.deepEqual(await result, [0, 2, 4, 6]);
  assert.equal(peak, 2);
  assert.equal(running, 0);
});

test('failure waits for in-flight work, stops scheduling, and suppresses sensitive errors', async () => {
  let unblock;
  const started = [];
  let finished = false;
  const pending = mapConcurrent([0, 1, 2], 2, async (value) => {
    started.push(value);
    if (value === 0) throw new Error('sensitive credential');
    await new Promise((resolve) => { unblock = resolve; });
    finished = true;
  });
  let settled = false;
  pending.then(() => { settled = true; }, () => { settled = true; });
  await new Promise(setImmediate);
  assert.equal(settled, false);
  unblock();
  await assert.rejects(pending, (error) => finished && !error.message.includes('sensitive credential'));
  assert.deepEqual(started, [0, 1]);
});

test('empty inputs complete and invalid limits fail without invoking the mapper', async () => {
  assert.deepEqual(await mapConcurrent([], 2, () => assert.fail('Empty mapper')), []);
  for (const limit of [0, -1, 17, 1.5, '2']) {
    await assert.rejects(mapConcurrent([1], limit, () => assert.fail('Invalid mapper')));
  }
});
