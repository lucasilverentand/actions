import test from 'node:test';
import assert from 'node:assert/strict';
import { configureProxy } from '../network.mjs';

test('proxy initialization preserves standard proxy and bypass settings and happens once', () => {
  configureProxy({}, () => assert.fail('No proxy requested'));
  const env = { https_proxy: 'http://localhost:3128', no_proxy: 'localhost,.example.com' };
  let calls = 0;
  configureProxy(env, (received) => { calls++; assert.equal(received, env); });
  configureProxy(env, () => assert.fail('Do not reset dispatchers during concurrent reads'));
  assert.equal(calls, 1);
});
