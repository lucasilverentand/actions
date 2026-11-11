import test from 'node:test';
import assert from 'node:assert/strict';
import { checkPullRequest, hasIssueReference, parseIssuePrefixes } from '../src/index.mjs';

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

test('applies independent summary length and repository scope policies', () => {
  assert.ok(checkPullRequest({ title: `fix: ${'a'.repeat(73)}`, body }).some((finding) => finding.includes('summary')));
  assert.deepEqual(checkPullRequest({ title: `fix: ${'a'.repeat(73)}`, body }, 100, { maxSummaryLength: 90 }), []);
  assert.ok(checkPullRequest({ title: 'fix(parser): handle input', body }, 100, { allowScopes: false }).some((finding) => finding.includes('Scopes')));
  assert.deepEqual(checkPullRequest({ title: `fix: ${'😀'.repeat(72)}`, body }), []);
});

test('counts content in subsections but not sibling sections or example fences', () => {
  const nested = '## Summary\n### Behavior\nHandle malformed input gracefully.\n## Testing\n### Unit tests\nCovered empty and malformed inputs.';
  assert.deepEqual(checkPullRequest({ title: 'fix: handle malformed input', body: nested }), []);
  const sibling = '## Summary\n## Unrelated\nThis content must not satisfy Summary.\n## Testing\nCovered empty and malformed inputs.';
  assert.ok(checkPullRequest({ title: 'fix: handle malformed input', body: sibling }).some((finding) => finding.includes('Summary')));
  const example = '## Summary\n```text\nA sufficiently long example only.\n```\n## Testing\nCovered empty and malformed inputs.';
  assert.ok(checkPullRequest({ title: 'fix: handle malformed input', body: example }).some((finding) => finding.includes('Summary')));
});

test('rejects formatting-only and repeated placeholder content', () => {
  for (const empty of ['***************', '- [ ] _____________', 'TODO TODO TODO TODO', '<br><br><br><br>', '**Describe your changes**', '_Describe your changes_', '[summary]: https://example.com/unused']) {
    assert.ok(checkPullRequest({ title: 'fix: handle input', body: `## Summary\n${empty}\n## Testing\nCovered empty and malformed inputs.` }).length);
  }
});

test('optional issue references accept allowed visible keys and reject hidden examples', () => {
  assert.equal(hasIssueReference('Related to ENG-123.', ['ENG']), true);
  assert.equal(hasIssueReference('[Issue](https://linear.app/example/issue/ENG-123/change)', ['ENG']), true);
  for (const hidden of ['<!-- ENG-123 -->', '```md\nENG-123\n```', '`ENG-123`', '`\nENG-123\n`', '``\nENG-123\n``', '[testing]: https://example.com/ENG-123', 'OTH-123', 'ENG-0']) {
    assert.equal(hasIssueReference(hidden, ['ENG']), false, hidden);
  }
  assert.deepEqual(checkPullRequest({ title: 'fix: handle input', body: `${body}\nRelated to ENG-123.` }, 100, { requireIssueReference: true, issuePrefixes: ['ENG'] }), []);
  assert.ok(checkPullRequest({ title: 'fix: handle input', body }, 100, { requireIssueReference: true }).some((finding) => finding.includes('tracked work')));
  assert.deepEqual(parseIssuePrefixes('["ENG", "OPS"]'), ['ENG', 'OPS']);
  for (const invalid of ['{}', '[".*"]', '[null]', '["eng"]']) assert.throws(() => parseIssuePrefixes(invalid));
});
