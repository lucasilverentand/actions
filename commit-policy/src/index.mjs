import { GitHub } from '../../lib/github.mjs';
import { checkCommitMessage } from '../../lib/commit-policy.mjs';
import { boolean, event, input, integer, output, runIfMain, summary } from '../../lib/runtime.mjs';

const sha = /^[a-f0-9]{40}$/;
const zero = '0'.repeat(40);

export function commitRange(payload, eventName, repository) {
  if (payload.repository?.full_name?.toLowerCase() !== repository.toLowerCase()) throw new Error('Event repository mismatch.');
  let before;
  let after;
  if (eventName === 'pull_request') {
    const pr = payload.pull_request;
    if (pr?.base?.repo?.full_name?.toLowerCase() !== repository.toLowerCase()) throw new Error('PR base repository mismatch.');
    before = pr.base.sha;
    after = pr.head?.sha;
  } else if (eventName === 'push') {
    if (!payload.ref?.startsWith('refs/heads/')) throw new Error('Only branch push events are supported.');
    if (payload.deleted === true && payload.after === zero) return null;
    before = payload.before;
    after = payload.after;
    if (before === zero) throw new Error('New branch pushes have no comparison base; use pull_request or an existing branch push.');
  } else throw new Error('Use commit-policy on pull_request or push events.');
  if (!sha.test(before ?? '') || !sha.test(after ?? '') || before === zero || after === zero) throw new Error('Missing immutable comparison SHAs.');
  return { before, after };
}

export async function readCommits(api, range, maxCommits = 250) {
  if (!Number.isSafeInteger(maxCommits) || maxCommits < 1 || maxCommits > 1000) throw new Error('Invalid commit limit.');
  if (!range) return [];
  const { before, after } = range;
  if (!sha.test(before ?? '') || !sha.test(after ?? '')) throw new Error('Expected full commit SHAs.');
  const commits = [];
  let total;
  for (let page = 1; page <= Math.ceil(maxCommits / 100); page++) {
    const result = await api.get(`/compare/${before}...${after}`, { per_page: 100, page });
    if (!Number.isSafeInteger(result.total_commits) || result.total_commits < 0 || result.total_commits > maxCommits) {
      throw new Error('Commit range is incomplete or exceeds max-commits.');
    }
    if (page === 1) total = result.total_commits;
    if (result.total_commits !== total || result.base_commit?.sha !== before || !Array.isArray(result.commits)) {
      throw new Error('Comparison metadata changed or is incomplete.');
    }
    if (result.commits.length !== Math.min(100, total - commits.length)) throw new Error('Incomplete commit page.');
    commits.push(...result.commits);
    if (commits.length === total) {
      const seen = new Set();
      for (const commit of commits) {
        if (!sha.test(commit.sha ?? '') || seen.has(commit.sha) || typeof commit.commit?.message !== 'string') {
          throw new Error('Invalid or duplicate commit data.');
        }
        seen.add(commit.sha);
      }
      if (total && !seen.has(after)) throw new Error('Comparison did not include the requested head.');
      return commits;
    }
  }
  throw new Error('Incomplete commit range.');
}

export function inspectCommits(commits, options) {
  return commits.flatMap((commit) => checkCommitMessage(commit.commit.message, options).map((message) => ({ sha: commit.sha, message })));
}

export async function main() {
  const api = new GitHub(input('token'));
  const range = commitRange(event(), process.env.GITHUB_EVENT_NAME, api.repository);
  const commits = await readCommits(api, range, integer(input('max-commits', '250'), 1, 1000));
  const findings = inspectCommits(commits, {
    maxSubjectLength: integer(input('max-subject-length', '100'), 40, 200),
    maxSummaryLength: integer(input('max-summary-length', '72'), 1, 200),
    allowScopes: boolean(input('allow-scopes', 'true')),
  });
  output('valid', findings.length === 0);
  output('checked-count', commits.length);
  output('findings', findings);
  summary('Commit policy', [
    range ? `Inspected ${commits.length} commits in the event's immutable comparison range.` : 'Branch deletion: no commit messages to inspect.',
    ...findings.map((finding) => `- ${finding.sha}: ${finding.message}`),
    ...(!findings.length ? ['All inspected commit messages satisfy the policy.'] : []),
  ]);
  console.log(`${commits.length} commits inspected; ${findings.length} findings. See the job summary.`);
  if (findings.length) process.exitCode = 1;
}

runIfMain(import.meta, main);
