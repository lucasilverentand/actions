import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { copyFile, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { parse } from 'yaml';

const execute = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const head = 'b'.repeat(40);

// Interpret the runner's output-file format, including multiline values and empty strings.
function outputs(source) {
  const result = {};
  const lines = source.trimEnd().split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const multi = /^([^=]+)<<(.+)$/.exec(line);
    let name;
    let value;
    if (multi) {
      name = multi[1];
      const body = [];
      while (++index < lines.length && lines[index] !== multi[2]) body.push(lines[index]);
      assert.ok(index < lines.length, 'multiline output delimiter must close');
      value = body.join('\n');
    } else {
      const separator = line.indexOf('=');
      assert.ok(separator > 0, `invalid output record: ${line}`);
      name = line.slice(0, separator);
      value = line.slice(separator + 1);
    }
    assert.equal(Object.hasOwn(result, name), false, `entry point emitted ${name} twice`);
    result[name] = value;
  }
  return result;
}

async function fixture(action, run) {
  // realpath handles macOS /var symlinks; spaces and URL conversion exercise Windows-safe paths.
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'action smoke path ')));
  try {
    const metadata = parse(await readFile(join(root, action, 'action.yml'), 'utf8'));
    const entry = join(directory, 'bundled action.mjs');
    await copyFile(join(root, action, metadata.runs.main), entry);
    const env = Object.fromEntries(Object.entries(process.env).filter(([name]) =>
      !name.startsWith('INPUT_') && !['NODE_OPTIONS', 'GH_TOKEN', 'GITHUB_TOKEN'].includes(name)));
    Object.assign(env, {
      GITHUB_API_URL: 'https://api.github.com', GITHUB_REPOSITORY: 'example/project',
      GITHUB_SHA: head, GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/main',
      GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1', RUNNER_TEMP: directory,
      GITHUB_OUTPUT: join(directory, 'action outputs'), GITHUB_STEP_SUMMARY: join(directory, 'action summary'),
    });
    await run({ directory, entry, env });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('CI gate bundle executes from a path with spaces and reports results', async () => {
  await fixture('ci-gate', async ({ directory, entry, env }) => {
    env.INPUT_NEEDS = JSON.stringify({ test: { result: 'success', outputs: { privateValue: 'do-not-copy-this-output' } } });
    env['INPUT_REQUIRED-JOBS'] = '["test"]';
    await execute(process.execPath, [entry], { cwd: directory, env });
    const result = outputs(await readFile(env.GITHUB_OUTPUT, 'utf8'));
    assert.equal(result.passed, 'true');
    assert.deepEqual(JSON.parse(result.failures), []);
    assert.deepEqual(Object.keys(result).sort(), ['failures', 'passed']);
    assert.match(await readFile(env.GITHUB_STEP_SUMMARY, 'utf8'), /All required upstream jobs satisfy the gate/);
  });
});

test('CI gate bundle fails when an explicitly required job is missing', async () => {
  await fixture('ci-gate', async ({ directory, entry, env }) => {
    env.INPUT_NEEDS = '{"test":{"result":"success"}}';
    env['INPUT_REQUIRED-JOBS'] = '["test", "security"]';
    await assert.rejects(execute(process.execPath, [entry], { cwd: directory, env }), (error) => error.code === 1);
    const result = outputs(await readFile(env.GITHUB_OUTPUT, 'utf8'));
    assert.equal(result.passed, 'false');
    assert.ok(JSON.parse(result.failures).some((failure) => failure.job === 'security' && failure.result === 'missing'));
  });
});

test('release bundle direct entry runs exactly once and dry-run performs no mutation', async () => {
  await fixture('release', async ({ directory, entry, env }) => {
    const preload = join(directory, 'fake GitHub fetch.mjs');
    env.FIXTURE_TRACE = join(directory, 'request trace');
    env.INPUT_TOKEN = 'fixture-token';
    env['INPUT_DRY-RUN'] = 'true';
    await writeFile(preload, `
      import { appendFile } from 'node:fs/promises';
      globalThis.fetch = async (url, options = {}) => {
        const parsed = new URL(url);
        const method = options.method ?? 'GET';
        const path = parsed.pathname + parsed.search;
        await appendFile(process.env.FIXTURE_TRACE, JSON.stringify({ method, path }) + '\\n');
        if (method !== 'GET' || parsed.origin !== 'https://api.github.com') throw new Error('Unexpected mutation or destination');
        let body;
        if (path === '/repos/example/project') body = { default_branch: 'main', archived: false, disabled: false, fork: false };
        else if (path === '/repos/example/project/git/ref/heads/main') body = { object: { sha: process.env.GITHUB_SHA } };
        else if (path === '/repos/example/project/releases?per_page=100&page=1') body = [];
        else if (path === '/repos/example/project/commits?sha=' + process.env.GITHUB_SHA + '&per_page=100&page=1') {
          body = [{ sha: process.env.GITHUB_SHA, commit: { message: 'feat: add portable checks' } }];
        } else throw new Error('Unexpected endpoint');
        return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
      };
    `);
    await execute(process.execPath, ['--import', pathToFileURL(preload).href, entry], { cwd: directory, env });
    const requests = (await readFile(env.FIXTURE_TRACE, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
    assert.deepEqual(requests, [
      { method: 'GET', path: '/repos/example/project' },
      { method: 'GET', path: '/repos/example/project/git/ref/heads/main' },
      { method: 'GET', path: '/repos/example/project/releases?per_page=100&page=1' },
      { method: 'GET', path: `/repos/example/project/commits?sha=${head}&per_page=100&page=1` },
    ]);
    const result = outputs(await readFile(env.GITHUB_OUTPUT, 'utf8'));
    assert.equal(result.planned, 'true');
    assert.equal(result.created, 'false');
    assert.equal(result.tag, 'v1.0.0');
    assert.equal(result.version, '1.0.0');
    assert.equal(result.url, '');
    assert.match(result.notes, /feat: add portable checks/);
    assert.equal((await readFile(env.GITHUB_STEP_SUMMARY, 'utf8')).match(/^## /gm).length, 1);
  });
});

test('bundled entry points report their own diagnostic instead of a generic failure', async () => {
  await fixture('branch-cleanup', async ({ directory, entry, env }) => {
    const failure = await execute(process.execPath, [entry], { cwd: directory, env }).catch((error) => error);
    assert.equal(failure.code, 1);
    assert.match(failure.stderr, /^::error::Cleanup requires a schedule or manual dispatch\.\r?\n$/);
  });
});

test('scheduled and push examples accept a runner selector; PR-triggered examples stay GitHub-hosted', async () => {
  const selector = "${{ fromJSON(vars.AUTOMATION_RUNNER || '\"ubuntu-latest\"') }}";
  const directory = join(root, 'docs', 'examples');
  for (const name of (await readdir(directory)).filter((file) => file.endsWith('.yml'))) {
    const workflow = parse(await readFile(join(directory, name), 'utf8'));
    const pullRequest = Object.keys(workflow.on).some((trigger) => trigger.startsWith('pull_request'));
    for (const job of Object.values(workflow.jobs)) {
      assert.equal(job['runs-on'], pullRequest ? 'ubuntu-latest' : selector, name);
    }
  }
});
