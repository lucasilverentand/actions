import { GitHub } from '../../lib/github.mjs';
import { boolean, escapeMarkdown, input, output, runIfMain, summary } from '../../lib/runtime.mjs';
import { auditRepository } from './audit.mjs';
export { auditRepository } from './audit.mjs';

export async function main() {
  const api = new GitHub(input('token'));
  const findings = await auditRepository(api, { requiredChecks: JSON.parse(input('required-checks', '[]')) });
  output('findings', findings);
  output('passed', !findings.some((f) => f.level === 'error'));
  summary('Repository audit', findings.length ? [
    '| Level | Rule | Finding |', '| --- | --- | --- |',
    ...findings.map((f) => `| ${f.level} | ${f.rule} | ${escapeMarkdown(f.message)}${f.path ? ` (${escapeMarkdown(f.path)})` : ''} |`),
  ] : ['All inspected settings satisfy the policy.']);
  console.log(`${findings.filter((f) => f.level === 'error').length} errors; ${findings.filter((f) => f.level === 'warning').length} warnings. See the job summary.`);
  if (boolean(input('fail-on-error', 'true')) && findings.some((f) => f.level === 'error')) process.exitCode = 1;
}

runIfMain(import.meta, main);
