import { boolean, event, input, integer, output, runIfMain, summary } from '../../lib/runtime.mjs';
import { checkSubject, types } from '../../lib/commit-policy.mjs';

export { types };

export function visibleBody(body) {
  const lines = [];
  let fence;
  for (const line of body.replace(/<!--[\s\S]*?(?:-->|$)/g, '').split(/\r?\n/)) {
    const marker = /^\s{0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (marker) {
      if (!fence) fence = marker[1];
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) fence = undefined;
      continue;
    }
    // Reference definitions are invisible unless used by a link; they cannot fill a description.
    if (!fence && !/^\s{0,3}\[[^\]]+\]:/.test(line)) lines.push(line);
  }
  return lines.join('\n');
}

export function parseIssuePrefixes(value) {
  const prefixes = JSON.parse(value);
  if (!Array.isArray(prefixes) || prefixes.length > 50 || prefixes.some((prefix) => !/^[A-Z][A-Z0-9]{0,19}$/.test(prefix))) {
    throw new Error('issue-prefixes must be a JSON array of uppercase issue keys.');
  }
  return prefixes;
}

export function hasIssueReference(body, prefixes = []) {
  const text = visibleBody(body).replace(/(?<!`)(`+)(?!`)[\s\S]*?(?<!`)\1(?!`)/g, '');
  const allowed = new Set(prefixes);
  return [...text.matchAll(/\b([A-Z][A-Z0-9]{0,19})-([1-9][0-9]*)\b/g)].some((match) => !allowed.size || allowed.has(match[1]));
}

export function checkPullRequest(pr, maxTitleLength = 100, options = {}) {
  const findings = checkSubject(pr.title ?? '', { maxSubjectLength: maxTitleLength, ...options });
  const body = typeof pr.body === 'string' ? pr.body : '';
  // Nested headings belong to their parent section. Examples and hidden comments do not count.
  const sections = new Map();
  let section;
  let level;
  for (const line of visibleBody(body).split('\n')) {
    const heading = /^\s{0,3}(#{1,6})\s+(.+?)(?:\s+#+)?\s*$/.exec(line);
    if (heading) {
      const name = heading[2].toLowerCase();
      if (['summary', 'testing'].includes(name)) {
        section = name;
        level = heading[1].length;
        if (!sections.has(section)) sections.set(section, []);
      } else if (section && heading[1].length <= level) section = undefined;
    } else if (section) sections.get(section).push(line);
  }
  for (const name of ['summary', 'testing']) {
    const content = (sections.get(name) ?? []).join('\n').trim();
    const meaningful = content.replace(/^\s*(?:[-*+]\s+)?(?:\[[ xX]\]\s*)?/gm, '').replace(/<[^>]*>/g, '').replace(/[*_`~]/g, '').trim();
    const letters = meaningful.match(/[\p{L}\p{N}]/gu) ?? [];
    if (letters.length < 12 || /^(?:(?:todo|tbd|n\/?a|none|not tested|describe (?:your changes|testing))[.!\s*_`~-]*)+$/i.test(meaningful)) {
      findings.push(`Add a substantive ${name === 'summary' ? '## Summary' : '## Testing'} section. Explain skipped tests when relevant.`);
    }
  }
  if (options.requireIssueReference && !hasIssueReference(body, options.issuePrefixes)) {
    findings.push('Link a tracked work item in the PR body using its issue key, for example: ENG-123.');
  }
  return findings;
}

export async function main() {
  if (process.env.GITHUB_EVENT_NAME !== 'pull_request') {
    throw new Error('Use this action only on pull_request events.');
  }
  const pr = event().pull_request;
  if (!pr) throw new Error('Missing pull request.');
  const findings = checkPullRequest(pr, integer(input('max-title-length', '100'), 40, 200), {
    maxSummaryLength: integer(input('max-summary-length', '72'), 1, 200),
    allowScopes: boolean(input('allow-scopes', 'true')),
    requireIssueReference: boolean(input('require-issue-reference', 'false')),
    issuePrefixes: parseIssuePrefixes(input('issue-prefixes', '[]')),
  });
  output('valid', findings.length === 0);
  summary('Pull request policy', findings.length ? findings.map((f) => `- ${f}`) : ['Title and body satisfy the policy.']);
  for (const finding of findings) console.error(finding);
  if (findings.length) process.exitCode = 1;
}

runIfMain(import.meta, main);
