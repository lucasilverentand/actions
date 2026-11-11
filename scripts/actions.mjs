import { readdir, access } from 'node:fs/promises';

// Discover the public action interfaces once for building, checking and packaging tests.
export const actions = [];
for (const entry of await readdir('.', { withFileTypes: true })) {
  if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === 'node_modules') continue;
  try { await access(`${entry.name}/action.yml`); }
  catch (error) { if (error.code === 'ENOENT') continue; throw error; }
  actions.push(entry.name);
}
actions.sort();
if (!actions.length) throw new Error('No public action manifests found; run from the repository root.');
