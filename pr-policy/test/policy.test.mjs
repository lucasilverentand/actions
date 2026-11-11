import test from 'node:test';
import assert from 'node:assert/strict';
import { checkPullRequest } from '../src/index.mjs';

const body = '## Summary\nHandle empty documents without throwing an exception.\n\n## Testing\nRan the parser unit tests, including empty input cases.';

test('accepts semantic titles, scopes, breaking changes, and descriptive bodies', () => {
  for (const title of ['fix(parser): handle empty input', 'feat!: change the API', 'chore: update dependencies']) {
    assert.deepEqual(checkPullRequest({ title, body }), []);
  }
});

test('rejects missing type, whitespace, newlines, and long titles', () => {
  for (const title of ['Update something', 'fix: ', ' fix: remove bug', 'fix: title\nmalicious', `fix: ${'a'.repeat(100)}`]) {
    assert.ok(checkPullRequest({ title, body }).length, title);
  }
});

test('rejects empty and template-only sections, including HTML comments', () => {
  for (const invalid of ['', '## Summary\n<!-- Describe your changes -->\n## Testing\nTODO', '## Summary\nTBD\n## Testing\nN/A']) {
    assert.ok(checkPullRequest({ title: 'fix: handle input', body: invalid }).length);
  }
});

test('supports skipped tests with an explanation and headings in mixed case', () => {
  assert.deepEqual(checkPullRequest({ title: 'docs: clarify setup', body: '## SUMMARY\nClarify installation on Linux.\n## Testing\nNot run: documentation-only changes.' }), []);
});

test('does not accept headings inside fences or an unterminated comment', () => {
  assert.ok(checkPullRequest({ title: 'fix: input handling', body: `\`\`\`md\n${body}\n\`\`\`` }).length);
  assert.ok(checkPullRequest({ title: 'fix: input handling', body: `<!--\n${body}` }).length);
});

test('treats attempted shell and workflow commands as inert data', () => {
  const title = 'fix: $(touch /tmp/should-never-exist)';
  assert.deepEqual(checkPullRequest({ title, body: `${body}\n::error::untrusted content` }), []);
});
