import { readFile } from 'node:fs/promises';

export function parseVersion(version) {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(version ?? '');
  if (!match || match.slice(1).some((part) => !Number.isSafeInteger(Number(part)))) {
    throw new Error('Use a stable semantic version such as 1.2.3.');
  }
  return match.slice(1).map(Number);
}

export function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  for (let index = 0; index < 3; index++) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  }
  return 0;
}

export function bumpVersion(version, level) {
  const index = ['major', 'minor', 'patch'].indexOf(level);
  if (index === -1) throw new Error('Choose major, minor, or patch.');
  const parts = parseVersion(version);
  parts[index]++;
  parts.fill(0, index + 1);
  const next = parts.join('.');
  parseVersion(next);
  return next;
}

export function validateMetadata(pkg, lock, changelog) {
  parseVersion(pkg.version);
  if (pkg.version !== lock.version || pkg.version !== lock.packages?.['']?.version) {
    throw new Error('Package and lockfile versions must match.');
  }
  const entries = [...changelog.matchAll(/^## \[(\d+\.\d+\.\d+)\] - (\d{4}-\d{2}-\d{2})\s*$/gm)];
  if (!entries.length || entries[0][1] !== pkg.version) {
    throw new Error('The newest changelog entry must match the package version.');
  }
  for (let index = 0; index < entries.length; index++) {
    parseVersion(entries[index][1]);
    if (index && compareVersions(entries[index - 1][1], entries[index][1]) <= 0) {
      throw new Error('Changelog versions must be unique and ordered newest first.');
    }
  }
  const notes = changelog.slice(entries[0].index + entries[0][0].length, entries[1]?.index).trim();
  if (notes.length < 20) throw new Error('Write release notes before publishing.');
  return { version: pkg.version, tag: `v${pkg.version}`, notes };
}

export async function readMetadata(directory = '.') {
  const [pkg, lock, changelog] = await Promise.all([
    readFile(`${directory}/package.json`, 'utf8').then(JSON.parse),
    readFile(`${directory}/package-lock.json`, 'utf8').then(JSON.parse),
    readFile(`${directory}/CHANGELOG.md`, 'utf8'),
  ]);
  return { pkg, lock, changelog, ...validateMetadata(pkg, lock, changelog) };
}
