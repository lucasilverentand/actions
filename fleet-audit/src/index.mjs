import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { boolean, input, integer, output, runIfMain, summary } from '../../lib/runtime.mjs';
import {
  auditFleet, inventoryReader, privateController, reportCounts, repositoryInspector, writePrivateReport,
} from '../../tools/fleet-audit/core.mjs';
import { inventoryOptions } from '../../tools/fleet-audit/inventory.mjs';

export async function validateRun(get, environment) {
  if (!['schedule', 'workflow_dispatch'].includes(environment.GITHUB_EVENT_NAME)) {
    throw new Error('Fleet audits require a schedule or manual dispatch.');
  }
  const controller = await privateController(get, environment.GITHUB_REPOSITORY);
  if (!controller.default_branch || environment.GITHUB_REF !== `refs/heads/${controller.default_branch}`) {
    throw new Error('Fleet audits must run on the controller default branch.');
  }
}

export async function main() {
  const token = input('token');
  const organization = input('organization');
  const options = inventoryOptions(organization ? ['--org', organization] : []);
  options.concurrency = integer(input('inspection-concurrency', '2'), 1, 4);
  const failOnError = boolean(input('fail-on-error', 'true'));
  const get = inventoryReader(token);
  await validateRun(get, process.env);
  const report = await auditFleet(get, options, repositoryInspector(token));
  // A controller made public during a long audit must not receive a new report or artifact path.
  await validateRun(get, process.env);
  const directory = await mkdtemp(join(process.env.RUNNER_TEMP || tmpdir(), 'fleet-audit-'));
  const path = await writePrivateReport(directory, report);
  const counts = reportCounts(report);
  output('report-path', path);
  output('repository-count', counts.repositories);
  output('error-count', counts.errors);
  output('passed', counts.errors === 0);
  // Findings and repository identities remain in the private report, never the summary or log.
  summary('Fleet audit', [
    `Audited ${counts.repositories} repositories; ${counts.failing} need attention (${counts.errors} errors).`,
    'Detailed findings are in the report-path output. Retain that report only in this private controller.',
  ]);
  console.log(`Audited ${counts.repositories} repositories; ${counts.errors} errors. See the private report.`);
  if (failOnError && counts.errors) process.exitCode = 1;
}

runIfMain(import.meta, main);
