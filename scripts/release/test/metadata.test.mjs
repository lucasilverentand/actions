import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeCommits, bumpVersion, compareVersions, parseVersion } from '../metadata.mjs';

const commits = (...messages) => messages.map((message) => ({ commit: { message } }));

test('semantic bumps reset lower components and compare numerically', () => {
  assert.equal(bumpVersion('1.2.3', 'patch'), '1.2.4');
  assert.equal(bumpVersion('1.2.3', 'minor'), '1.3.0');
  assert.equal(bumpVersion('1.2.3', 'major'), '2.0.0');
  assert.equal(compareVersions('1.10.0', '1.9.9'), 1);
});

test('rejects malformed, prerelease, overflowing, and ambiguous versions', () => {
  for (const version of ['v1.2.3', '01.2.3', '1.2', '1.2.3-beta', '999999999999999999.0.0']) assert.throws(() => parseVersion(version));
  assert.throws(() => bumpVersion('1.2.3', 'automatic'));
});

test('chooses patch for fixes and maintenance, minor for features, and the largest bump for a batch', () => {
  for (const type of ['fix', 'perf', 'docs', 'style', 'refactor', 'test', 'build', 'ci', 'chore', 'revert']) {
    assert.equal(analyzeCommits(commits(`${type}(policy): improve behavior`)), 'patch');
  }
  assert.equal(analyzeCommits(commits('fix: resolve a bug', 'feat: add automation', 'docs: describe the change')), 'minor');
});

test('recognizes breaking headers and footers and never silently ignores unknown commit formats', () => {
  for (const message of ['feat!: simplify inputs', 'fix(api)!: remove a field', 'refactor: simplify inputs\n\nBREAKING CHANGE: remove a field', 'chore: simplify inputs\n\nBREAKING-CHANGE: remove a field']) {
    assert.equal(analyzeCommits(commits(message, 'feat: add a feature')), 'major');
  }
  assert.equal(analyzeCommits([]), null);
  assert.throws(() => analyzeCommits(commits('Unclassified change')));
  assert.throws(() => analyzeCommits(commits('unknown: unrecognized type')));
  for (const message of ['feat:   ', 'feat: valid\u0001hidden', 'fix: leading\u202ehidden']) assert.throws(() => analyzeCommits(commits(message)));
});
