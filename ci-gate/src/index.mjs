import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { evaluateJobs } from '../../lib/job-results.mjs';
import { escapeMarkdown, input, output, runIfMain, summary } from '../../lib/runtime.mjs';

export { evaluateJobs } from '../../lib/job-results.mjs';

export async function main() {
  const result = evaluateJobs(JSON.parse(input('needs')), {
    required: JSON.parse(input('required-jobs', '[]')),
    allowSkipped: JSON.parse(input('allow-skipped', '[]')),
  });
  output('passed', result.passed);
  output('failures', result.failures);
  let receipt = '';
  if (process.env.RUNNER_TEMP) {
    const directory = await mkdtemp(join(process.env.RUNNER_TEMP, 'ci-gate-'));
    receipt = join(directory, 'receipt.json');
    await writeFile(receipt, JSON.stringify({
      repository: process.env.GITHUB_REPOSITORY,
      sourceSha: process.env.GITHUB_SHA,
      runId: process.env.GITHUB_RUN_ID,
      runAttempt: process.env.GITHUB_RUN_ATTEMPT,
      ...result,
    }, null, 2) + '\n', { mode: 0o600 });
  }
  output('receipt-path', receipt);
  summary('Required jobs', result.passed ? ['All required upstream jobs satisfy the gate.']
    : result.failures.map((f) => `- ${escapeMarkdown(f.job)}: ${f.result}.`));
  if (!result.passed) process.exitCode = 1;
}

runIfMain(import.meta, main);
