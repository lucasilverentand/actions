import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { build } from 'esbuild';

const execute = promisify(execFile);

test('direct fleet bundle invocation refuses a public controller before inspecting repositories', async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'fleet-entry-')));
  try {
    const entry = join(directory, 'fleet.mjs');
    const preload = join(directory, 'preload.mjs');
    const requests = join(directory, 'requests.jsonl');
    await build({
      entryPoints: ['fleet-audit/src/index.mjs'], outfile: entry, bundle: true,
      platform: 'node', target: 'node24', format: 'esm',
      banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
    });
    await writeFile(preload, `
      import { appendFileSync } from 'node:fs';
      globalThis.fetch = async (url) => {
        appendFileSync(process.env.FLEET_REQUESTS, JSON.stringify(String(url)) + '\\n');
        return { ok: true, status: 200, json: async () => ({ private: false, default_branch: 'main' }) };
      };
    `);
    await assert.rejects(execute(process.execPath, ['--import', pathToFileURL(preload).href, entry], { env: {
      ...process.env, GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REPOSITORY: 'example/controller',
      GITHUB_REF: 'refs/heads/main', INPUT_TOKEN: 'test-token', FLEET_REQUESTS: requests,
      GITHUB_OUTPUT: join(directory, 'outputs'), GITHUB_STEP_SUMMARY: join(directory, 'summary'),
    } }), (error) => error.code === 1);
    assert.deepEqual((await readFile(requests, 'utf8')).trim().split('\n').map(JSON.parse), [
      'https://api.github.com/repos/example/controller',
    ]);
    await assert.rejects(readFile(join(directory, 'outputs')), { code: 'ENOENT' });
    await assert.rejects(readFile(join(directory, 'summary')), { code: 'ENOENT' });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
