import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir, EOL } from 'node:os';
import { output } from '../runtime.mjs';

test('outputs use raw scalars, JSON structures and injection-safe multiline delimiters', () => {
  const directory = mkdtempSync(join(tmpdir(), 'action-output-'));
  const previous = process.env.GITHUB_OUTPUT;
  try {
    process.env.GITHUB_OUTPUT = join(directory, 'output');
    output('path', '/tmp/a file.json');
    output('passed', true);
    output('items', ['a']);
    output('notes', 'hello\npassed=false\nEOF\nworld');
    const content = readFileSync(process.env.GITHUB_OUTPUT, 'utf8').replaceAll(EOL, '\n');
    assert.match(content, /^path=\/tmp\/a file.json\npassed=true\nitems=\["a"\]\n/);
    const delimiter = /notes<<(output_[^\n]+)/.exec(content)[1];
    assert.ok(content.endsWith(`hello\npassed=false\nEOF\nworld\n${delimiter}\n`));
    output('trailing', 'hello\r');
    const raw = readFileSync(process.env.GITHUB_OUTPUT, 'utf8');
    assert.ok(raw.includes(`hello\r${EOL}output_`));
    assert.throws(() => output('bad\ninjection', 'x'));
    assert.throws(() => output('empty', undefined));
  } finally {
    if (previous === undefined) delete process.env.GITHUB_OUTPUT; else process.env.GITHUB_OUTPUT = previous;
    rmSync(directory, { recursive: true, force: true });
  }
});

test('failures show fixed library diagnostics but keep platform errors generic', async () => {
  const { failureMessage } = await import('../runtime.mjs');
  const { ApiError } = await import('../github.mjs');
  const generic = '::error::Action failed. Check its configuration, token permissions, and GitHub API availability.';
  assert.equal(failureMessage(new Error('Use this action only on pull_request events.')), '::error::Use this action only on pull_request events.');
  assert.equal(failureMessage(new ApiError(403)), '::error::GitHub API returned 403.');
  assert.equal(failureMessage(Object.assign(new Error('Release API returned 404.'), { status: 404 })), '::error::Release API returned 404.');
  // Parser, network, filesystem and child-process errors can echo inputs, URLs, paths or command lines.
  let parseError;
  try { JSON.parse('{"secret-value"'); } catch (error) { parseError = error; }
  for (const error of [parseError, new TypeError('fetch failed'), Object.assign(new Error('ENOENT: /private/path'), { code: 'ENOENT' }),
    Object.assign(new Error('Command failed: git push https://github.com/x'), { code: 1, cmd: 'git push' }),
    new Error('wrapped', { cause: new Error('inner') }), 'not an error', undefined]) {
    assert.equal(failureMessage(error), generic);
  }
  // A message cannot inject a second workflow command or a percent-encoded newline.
  const injected = failureMessage(new Error('bad\n::add-mask::x\r' + String.fromCharCode(0x2028) + '%0A'));
  assert.equal(injected.split(/[\r\n\u2028]/u).length, 1);
  assert.equal(injected, '::error::bad ::add-mask::x %250A');
  assert.equal(failureMessage(new Error('x'.repeat(500))).length, '::error::'.length + 300);
});
