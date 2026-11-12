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
  summary('Required jobs', result.passed ? ['All required upstream jobs satisfy the gate.']
    : result.failures.map((f) => `- ${escapeMarkdown(f.job)}: ${f.result}.`));
  if (!result.passed) process.exitCode = 1;
}

runIfMain(import.meta, main);
