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
