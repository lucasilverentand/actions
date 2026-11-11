import test from 'node:test';
import assert from 'node:assert/strict';

test('published bundles load in Node without node_modules resolution', async () => {
  for (const name of ['pr-policy', 'repository-audit', 'branch-cleanup']) {
    const bundle = await import(`../dist/${name}.mjs`);
    assert.equal(typeof bundle.main, 'function');
  }
});
