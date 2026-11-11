import test from 'node:test';
import assert from 'node:assert/strict';
import { bumpVersion, compareVersions, parseVersion, validateMetadata } from '../metadata.mjs';

const changelog = '# Changelog\n\n## [1.2.3] - 2026-11-11\n\n- Handle empty input without throwing.\n\n## [1.2.2] - 2026-11-10\n\n- Earlier published behavior.\n';
const pkg = { version: '1.2.3' };
const lock = { version: '1.2.3', packages: { '': { version: '1.2.3' } } };

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

test('extracts only the current version release notes', () => {
  const result = validateMetadata(pkg, lock, changelog);
  assert.equal(result.tag, 'v1.2.3');
  assert.match(result.notes, /Handle empty input/);
  assert.doesNotMatch(result.notes, /Earlier published/);
});

test('rejects mismatched metadata, duplicate or misordered versions, and missing notes', () => {
  assert.throws(() => validateMetadata(pkg, { ...lock, version: '1.2.2' }, changelog));
  assert.throws(() => validateMetadata(pkg, { ...lock, packages: { '': { version: '1.2.2' } } }, changelog));
  assert.throws(() => validateMetadata(pkg, lock, changelog.replace('[1.2.3]', '[1.2.4]')));
  assert.throws(() => validateMetadata(pkg, lock, changelog.replace('[1.2.2]', '[1.2.3]')));
  assert.throws(() => validateMetadata(pkg, lock, changelog.replace('- Handle empty input without throwing.', 'TODO')));
});
