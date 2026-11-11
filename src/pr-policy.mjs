import { event, input, integer, output, runIfMain, summary } from './runtime.mjs';

export const types = ['feat', 'fix', 'docs', 'style', 'refactor', 'perf', 'test', 'build', 'ci', 'chore', 'revert'];

export function checkPullRequest(pr, maxTitleLength = 100) {
  const findings = [];
  const title = pr.title ?? '';
  const match = /^(\w+)(?:\([a-zA-Z0-9][a-zA-Z0-9._/-]*\))?(!)?: (\S.*\S|\S)$/.exec(title);
  if (!match || !types.includes(match[1]) || /[\r\n\x00-\x1f\x7f]/.test(title)) {
    findings.push('Use a Conventional Commit title, for example: fix(parser): handle empty input.');
  }
  if ([...title].length > maxTitleLength) findings.push(`Keep the title within ${maxTitleLength} characters.`);
  if (title !== title.trim()) findings.push('Remove whitespace around the title.');

  const body = (pr.body ?? '').replace(/<!--[\s\S]*?(?:-->|$)/g, '');
  // Headings inside fenced examples do not satisfy the policy.
  const sections = new Map();
  let section;
  let fence;
  for (const line of body.split(/\r?\n/)) {
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) {
      if (!fence) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = undefined;
      continue;
    }
    const heading = !fence && /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) {
      section = heading[1].toLowerCase();
      if (!sections.has(section)) sections.set(section, []);
    } else if (section) sections.get(section).push(line);
  }
  for (const name of ['summary', 'testing']) {
    const content = (sections.get(name) ?? []).join('\n').trim();
    const meaningful = content.replace(/^[\s>*_`~\-+\[\]x]+/gm, '').trim();
    if (meaningful.length < 12 || /^(?:todo|tbd|n\/?a|none|not tested|describe (?:your changes|testing))[.!\s]*$/i.test(meaningful)) {
      findings.push(`Add a substantive ${name === 'summary' ? '## Summary' : '## Testing'} section. Explain skipped tests when relevant.`);
    }
  }
  return findings;
}

export async function main() {
  if (process.env.GITHUB_EVENT_NAME !== 'pull_request') {
    throw new Error('Use this action only on pull_request events.');
  }
  const pr = event().pull_request;
  if (!pr) throw new Error('Missing pull request.');
  const findings = checkPullRequest(pr, integer(input('max-title-length', '100'), 40, 200));
  output('valid', findings.length === 0);
  summary('Pull request policy', findings.length ? findings.map((f) => `- ${f}`) : ['Title and body satisfy the policy.']);
  for (const finding of findings) console.error(finding);
  if (findings.length) process.exitCode = 1;
}

runIfMain(import.meta, main);
