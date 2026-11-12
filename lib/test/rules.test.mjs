import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { applyRules, knownRules, parseRules, parseTrustedOwners } from '../rules.mjs';

test('rule overrides preserve order and inputs and never change unverified findings', () => {
  const findings = [{ rule: 'description', level: 'warning' }, { rule: 'workflow-pin', level: 'error' },
    { rule: 'workflow-parse', level: 'error', unverified: true }];
  const original = structuredClone(findings);
  for (const level of ['off', 'warning', 'error']) {
    const result = applyRules(findings, { description: 'error', 'workflow-pin': 'off', 'workflow-parse': level });
    assert.deepEqual(result, [{ rule: 'description', level: 'error' }, original[2]]);
  }
  assert.equal(applyRules(findings, { 'workflow-pin': 'warning' })[1].level, 'warning');
  assert.deepEqual(findings, original);
});

test('rule and owner input validation rejects invalid JSON, shapes, values and limits', () => {
  assert.deepEqual(parseRules('{"description":"off"}'), { description: 'off' });
  for (const value of ['[ ]', 'null', '1', '{', '{"unknown":"off"}', '{"description":"bad"}', JSON.stringify(Object.fromEntries(Array.from({length: 101}, (_, i) => [i, 'off'])))]) assert.throws(() => parseRules(value), /rules must be/);
  assert.deepEqual(parseTrustedOwners('["example-org"]'), ['example-org']);
  for (const value of ['{}', 'null', '[1]', '["bad owner"]', '["-bad"]', '["' + 'a'.repeat(40) + '"]', JSON.stringify(Array(51).fill('example'))]) assert.throws(() => parseTrustedOwners(value), /trusted-owners must be/);
});

test('known rules include every literal and dynamically generated rule in audit sources', async () => {
  const paths = ['repository-audit/src/audit.mjs', 'repository-audit/src/workflows.mjs', 'workflow-policy/src/index.mjs', 'tools/fleet-audit/core.mjs'];
  const source = (await Promise.all(paths.map((path) => readFile(path, 'utf8')))).join('\n');
  const ids = [...source.matchAll(/(?:add\(|inspect\(|rule:\s*)'([^']+)'/g)].map((match) => match[1]);
  for (const feature of [...source.matchAll(/'?(secret_scanning(?:_push_protection)?)'?/g)]) ids.push(feature[1].replaceAll('_', '-'));
  for (const id of ids) assert.ok(knownRules.includes(id), `Missing rule: ${id}`);
});
