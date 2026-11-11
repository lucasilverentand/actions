import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { readMetadata } from '../metadata.mjs';

const execute = promisify(execFile);

test('preparation updates package, lockfile and changelog together without committing or tagging', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'release-prepare-'));
  const script = resolve('scripts/release/prepare.mjs');
  const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
  const git = (...args) => execute('git', ['-c', 'commit.gpgsign=false', '-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], { cwd: directory, env });
  try {
    await writeFile(join(directory, 'package.json'), JSON.stringify({ version: '1.2.3', private: true }));
    await writeFile(join(directory, 'package-lock.json'), JSON.stringify({ version: '1.2.3', packages: { '': { version: '1.2.3' } } }));
    await writeFile(join(directory, 'CHANGELOG.md'), '# Changelog\n\n## [1.2.3] - 2026-11-11\n\n- Publish the preceding reviewed version.\n');
    await git('init', '-b', 'main');
    await git('add', '.');
    await git('commit', '-m', 'chore: release 1.2.3');
    await git('-c', 'tag.gpgsign=false', 'tag', 'v1.2.3');
    await writeFile(join(directory, 'feature.txt'), 'A reviewed feature.\n');
    await git('add', '.');
    await git('commit', '-m', 'feat: add release preparation');
    const before = (await git('rev-parse', 'HEAD')).stdout;
    await execute(process.execPath, [script, 'minor'], { cwd: directory, env });
    const metadata = await readMetadata(directory);
    assert.equal(metadata.version, '1.3.0');
    assert.match(metadata.notes, /feat: add release preparation/);
    assert.equal(JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')).private, true);
    assert.equal((await git('rev-parse', 'HEAD')).stdout, before);
    assert.equal((await git('tag', '--list')).stdout.trim(), 'v1.2.3');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
