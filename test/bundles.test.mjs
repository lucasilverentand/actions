import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir, EOL } from 'node:os';
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

test('PR action executes through its relocated manifest entry point', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pr-action-'));
  try {
    const eventPath = join(directory, 'event.json');
    const outputPath = join(directory, 'output');
    const summaryPath = join(directory, 'summary');
    await writeFile(eventPath, JSON.stringify({ pull_request: {
      title: 'refactor: organize action packages',
      body: '## Summary\nColocate public action implementation files.\n## Testing\nRun the package loading and policy tests.',
    } }));
    const metadata = parse(await readFile('pr-policy/action.yml', 'utf8'));
    const entry = resolve('pr-policy', metadata.runs.main);
    await execute(process.execPath, [entry], { env: {
      ...process.env,
      GITHUB_EVENT_NAME: 'pull_request', GITHUB_EVENT_PATH: eventPath,
      GITHUB_OUTPUT: outputPath, GITHUB_STEP_SUMMARY: summaryPath,
    } });
    assert.equal(await readFile(outputPath, 'utf8'), `valid=true${EOL}`);
    assert.match(await readFile(summaryPath, 'utf8'), /Title and body satisfy/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
