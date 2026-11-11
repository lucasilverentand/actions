import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { runIfMain } from '../../lib/runtime.mjs';
import { bumpVersion, readMetadata, validateMetadata } from './metadata.mjs';

export async function main() {
  const level = process.argv[2];
  if (process.argv.length !== 3) throw new Error('Run npm run release:prepare -- major|minor|patch.');
  const metadata = await readMetadata();
  const version = bumpVersion(metadata.version, level);
  const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
  if (git('status', '--porcelain')) throw new Error('Commit your changes before preparing a release.');
  git('rev-parse', '--verify', `refs/tags/${metadata.tag}`);
  const subjects = git('log', '--format=%s', `${metadata.tag}..HEAD`).split('\n').filter(Boolean);
  if (!subjects.length) throw new Error('There are no commits to release.');
  const date = new Date().toISOString().slice(0, 10);
  const entry = `## [${version}] - ${date}\n\n${subjects.map((subject) => `- ${subject}`).join('\n')}\n\n`;
  const firstEntry = metadata.changelog.indexOf('## [');
  const changelog = metadata.changelog.slice(0, firstEntry) + entry + metadata.changelog.slice(firstEntry);
  const pkg = { ...metadata.pkg, version };
  const lock = { ...metadata.lock, version, packages: {
    ...metadata.lock.packages, '': { ...metadata.lock.packages[''], version },
  } };
  validateMetadata(pkg, lock, changelog);
  await writeFile('package.json', `${JSON.stringify(pkg, null, 2)}\n`);
  await writeFile('package-lock.json', `${JSON.stringify(lock, null, 2)}\n`);
  await writeFile('CHANGELOG.md', changelog);
  console.log(`Prepared v${version}. Review CHANGELOG.md, commit the three version files, and open a pull request.`);
}

runIfMain(import.meta, main);
