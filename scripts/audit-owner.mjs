import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { GitHub } from '../src/github.mjs';
import { auditRepository } from '../src/repository-audit.mjs';

// Fleet findings belong on a local machine or in a private controller repository.
if (process.env.GITHUB_ACTIONS && process.env.GITHUB_REPOSITORY_VISIBILITY !== 'private') {
  throw new Error('Fleet audits may run only locally or in a private repository.');
}
const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim();
const directory = resolve('reports');
await mkdir(directory, { recursive: true, mode: 0o700 });

async function get(path) {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' },
    redirect: 'error', signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Inventory request failed (${response.status}).`);
  return response.json();
}

try {
  const user = await get('/user');
  const results = [];
  let complete = false;
  for (let page = 1; page <= 100; page++) {
    const repos = await get(`/user/repos?affiliation=owner&per_page=100&page=${page}`);
    for (const repo of repos) {
      if (repo.owner.login !== user.login || repo.archived || repo.disabled || repo.fork) continue;
      const api = new GitHub(token, repo.full_name);
      try {
        results.push({ repository: repo.full_name, findings: await auditRepository(api) });
      } catch {
        results.push({ repository: repo.full_name, findings: [{ level: 'error', rule: 'inspection', message: 'Repository inspection failed or is inaccessible.' }] });
      }
    }
    if (repos.length < 100) { complete = true; break; }
  }
  if (!complete) throw new Error('Incomplete inventory.');
  await writeFile(join(directory, 'audit.json'), `${JSON.stringify({ generatedAt: new Date().toISOString(), repositories: results }, null, 2)}\n`, { mode: 0o600 });
  const failing = results.filter((r) => r.findings.some((f) => f.level === 'error')).length;
  console.log(`Audited ${results.length} owned, active, non-fork repositories; ${failing} need attention. Details are in reports/audit.json.`);
  if (failing) process.exitCode = 1;
} catch {
  console.error('Fleet audit failed. Verify inventory access, token permissions, and API availability.');
  process.exitCode = 1;
}
