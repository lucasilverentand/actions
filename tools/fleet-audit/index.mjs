import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { inventoryOptions } from './inventory.mjs';
import { auditFleet, inventoryReader, privateController, reportCounts, repositoryInspector, writePrivateReport } from './core.mjs';

try {
  const options = inventoryOptions(process.argv.slice(2));
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || execFileSync('gh', ['auth', 'token'], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
  const get = inventoryReader(token);
  if (process.env.GITHUB_ACTIONS) await privateController(get, process.env.GITHUB_REPOSITORY);
  const report = await auditFleet(get, options, repositoryInspector(token));
  if (process.env.GITHUB_ACTIONS) await privateController(get, process.env.GITHUB_REPOSITORY);
  await writePrivateReport(resolve('reports'), report);
  const counts = reportCounts(report);
  console.log(`Audited ${counts.repositories} selected, active, non-fork repositories; ${counts.failing} need attention. Details are in reports/audit.json.`);
  if (counts.errors) process.exitCode = 1;
} catch {
  console.error('Fleet audit failed. Verify inventory access, token permissions, and API availability.');
  process.exitCode = 1;
}
