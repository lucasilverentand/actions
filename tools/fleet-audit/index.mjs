import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { GitHub } from '../../lib/github.mjs';
import { auditRepository } from '../../repository-audit/src/index.mjs';
import { inventoryOptions, ownedRepositories } from './inventory.mjs';

// Fleet findings belong on a local machine or in a private controller repository.
const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim();
const directory = resolve('reports');

async function get(path) {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' },
    redirect: 'error', signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw Object.assign(new Error('Inventory request failed.'), { status: response.status });
  return response.json();
}

try {
  const options = inventoryOptions(process.argv.slice(2));
  if (process.env.GITHUB_ACTIONS) {
    const controller = process.env.GITHUB_REPOSITORY;
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(controller ?? '') ||
        (await get(`/repos/${controller}`)).private !== true) {
      throw new Error('Fleet audits require a private controller.');
    }
  }
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const results = [];
  for (const repo of await ownedRepositories(get, options)) {
    const api = new GitHub(token, repo.full_name);
    try {
      results.push({ repository: repo.full_name, findings: await auditRepository(api) });
    } catch {
      results.push({ repository: repo.full_name, findings: [{ level: 'error', rule: 'inspection', message: 'Repository inspection failed or is inaccessible.' }] });
    }
  }
  const scope = options.organization ? { organization: options.organization } : { personal: true };
  await writeFile(join(directory, 'audit.json'), `${JSON.stringify({ generatedAt: new Date().toISOString(), scope, repositories: results }, null, 2)}\n`, { mode: 0o600 });
  const failing = results.filter((r) => r.findings.some((f) => f.level === 'error')).length;
  console.log(`Audited ${results.length} selected, active, non-fork repositories; ${failing} need attention. Details are in reports/audit.json.`);
  if (failing) process.exitCode = 1;
} catch {
  console.error('Fleet audit failed. Verify inventory access, token permissions, and API availability.');
  process.exitCode = 1;
}
