import { readFile, readdir, stat } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import assert from 'node:assert/strict';
import { parse } from 'yaml';
import { inspectWorkflow } from '../repository-audit/src/workflows.mjs';
import { actions } from './actions.mjs';

for (const action of actions) {
  const path = `${action}/action.yml`;
  const metadata = parse(await readFile(path, 'utf8'));
  assert.equal(metadata.runs.using, 'node24');
  assert.ok((await stat(resolve(dirname(path), metadata.runs.main))).isFile());
}
for (const directory of ['.github/workflows', 'docs/examples']) {
  for (const name of await readdir(directory)) {
    if (!/\.ya?ml$/.test(name)) continue;
    const path = `${directory}/${name}`;
    const source = await readFile(path, 'utf8');
    const metadata = parse(source);
    assert.ok(metadata.on && metadata.jobs, path);
    assert.deepEqual(inspectWorkflow(source, path), [], path);
  }
}
console.log('Action manifests, bundled entry points, and workflow policy checks pass.');
