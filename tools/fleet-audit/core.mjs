import { chmod, lstat, mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { GitHub } from '../../lib/github.mjs';
import { mapConcurrent } from '../../lib/concurrency.mjs';
import { auditRepository } from '../../repository-audit/src/audit.mjs';
import { ownedRepositories } from './inventory.mjs';
import { configureProxy } from '../../lib/network.mjs';
import { escapeMarkdown } from '../../lib/runtime.mjs';

export function inventoryReader(token, fetcher = fetch) {
  configureProxy();
  if (!token) throw new Error('A fleet audit credential is required.');
  return async function get(path) {
    if (!path.startsWith('/') || path.startsWith('//')) throw new Error('Invalid inventory API path.');
    const response = await fetcher(`https://api.github.com${path}`, {
      headers: {
        authorization: `Bearer ${token}`, accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28', 'user-agent': 'repository-hygiene-actions',
      },
      redirect: 'error', signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw Object.assign(new Error('Inventory request failed.'), { status: response.status });
    return response.json();
  };
}

export async function privateController(get, repository) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? '')) {
    throw new Error('A controller repository is required.');
  }
  const controller = await get(`/repos/${repository}`);
  if (controller.private !== true || controller.visibility !== 'private') throw new Error('Fleet audits require a private controller.');
  return controller;
}

export async function auditFleet(get, options, inspect) {
  // Finish discovery before producing a report: a partial inventory must never pass.
  const inventory = await ownedRepositories(get, options);
  const repositories = await mapConcurrent(inventory, options.concurrency ?? 2, async (repo) => {
    try {
      return { repository: repo.full_name, findings: await inspect(repo.full_name) };
    } catch {
      return { repository: repo.full_name, findings: [{
        level: 'error', rule: 'inspection', message: 'Repository inspection failed or is inaccessible.',
      }] };
    }
  });
  return {
    generatedAt: new Date().toISOString(),
    scope: options.organization ? { organization: options.organization } : { personal: true },
    repositories,
  };
}

export function repositoryInspector(token) {
  return (repository) => auditRepository(new GitHub(token, repository));
}

export function reportCounts(report) {
  return {
    repositories: report.repositories.length,
    failing: report.repositories.filter((repo) => repo.findings.some((finding) => finding.level === 'error')).length,
    errors: report.repositories.reduce((total, repo) => total + repo.findings.filter((finding) => finding.level === 'error').length, 0),
  };
}

// Job summary lines for the verified-private controller: repositories needing attention and why.
// Errors come first; the line cap keeps large fleets within GitHub's summary size limit.
export function reportSummary(report, maxLines = 300) {
  const rank = (repo) => repo.findings.some((finding) => finding.level === 'error') ? 0 : 1;
  const flagged = report.repositories.filter((repo) => repo.findings.length)
    .sort((a, b) => rank(a) - rank(b) || a.repository.localeCompare(b.repository));
  const lines = [];
  let omitted = 0;
  for (const repo of flagged) {
    const findings = [...repo.findings].sort((a, b) => (a.level === 'error' ? 0 : 1) - (b.level === 'error' ? 0 : 1));
    for (const [index, finding] of findings.entries()) {
      if (lines.length >= maxLines) { omitted += findings.length - index; break; }
      if (index === 0) lines.push(`- **${escapeMarkdown(repo.repository)}**`);
      const path = finding.path ? ` (${escapeMarkdown(finding.path)})` : '';
      lines.push(`  - ${escapeMarkdown(finding.level)}: ${escapeMarkdown(finding.message)}${path}`);
    }
  }
  if (omitted) lines.push('', `${omitted} more findings are only in the private report.`);
  return lines;
}

export async function writePrivateReport(directory, report) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Report directory must be a real directory.');
  await chmod(directory, 0o700);
  const temporary = await mkdtemp(join(directory, '.audit-'));
  const destination = join(directory, 'audit.json');
  try {
    const path = join(temporary, 'audit.json');
    await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    // Atomic replacement avoids following an existing report symlink or retaining broad file permissions.
    await rename(path, destination);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
  return destination;
}
