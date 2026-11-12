import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { parse } from 'yaml';
import { actions } from '../scripts/actions.mjs';

const execute = promisify(execFile);

test('published manifests resolve to bundles that load without repository dependencies', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'action-packages-'));
  try {
    for (const name of actions) {
      await cp(name, join(directory, name), { recursive: true });
      const metadata = parse(await readFile(join(directory, name, 'action.yml'), 'utf8'));
      const entry = resolve(directory, name, metadata.runs.main);
      const { stdout } = await execute(process.execPath, [
        '--input-type=module', '-e',
        'const bundle = await import(process.env.BUNDLE_ENTRY); console.log(typeof bundle.main);',
      ], { cwd: directory, env: { ...process.env, BUNDLE_ENTRY: pathToFileURL(entry).href } });
      assert.equal(stdout.trim(), 'function');
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
