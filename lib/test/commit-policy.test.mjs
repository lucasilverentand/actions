import test from 'node:test';
import assert from 'node:assert/strict';
import { checkSubject } from '../commit-policy.mjs';

test('validates commit subjects, scopes, and Unicode lengths', () => {
  for (const subject of ['fix: handle empty input', 'feat!: replace old API', 'docs: explain setup']) {
    assert.deepEqual(checkSubject(subject), []);
  }
  for (const subject of ['Fix: upper case type', 'fix: ', 'fixup! fix: handle input', 'fix: unsafe\u202e subject', `fix: ${'a'.repeat(96)}`]) {
    assert.ok(checkSubject(subject).length, subject);
  }
  assert.deepEqual(checkSubject(`fix: ${'😀'.repeat(72)}`), []);
  assert.ok(checkSubject('fix(core): handle input', { allowScopes: false }).length);
  assert.deepEqual(checkSubject(`fix: ${'a'.repeat(73)}`), []);
  assert.ok(checkSubject(`fix: ${'a'.repeat(73)}`, { maxSummaryLength: 72 }).length);
});
