import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { GitHub } from './github.mjs';
import { boolean, escapeMarkdown, input, integer, output, runIfMain, summary } from './runtime.mjs';

const execute = promisify(execFile);
const keptNames = new Set(['main', 'master', 'trunk', 'dev', 'develop', 'development', 'staging', 'production', 'gh-pages']);
const keptPrefixes = ['release/', 'releases/', 'hotfix/'];

export function retained(name, defaultBranch, extraPrefixes = []) {
  return name === defaultBranch || keptNames.has(name) || [...keptPrefixes, ...extraPrefixes].some((prefix) => name.startsWith(prefix));
}

export function oldEnough(value, days, now) {
  const date = Date.parse(value);
  return Number.isFinite(date) && date <= now - days * 86_400_000;
}

export function openBranches(pulls, repoId) {
  return new Set(pulls.flatMap((pr) => [pr.base.ref, ...(pr.head.repo?.id === repoId ? [pr.head.ref] : [])]));
}

export async function eligible(api, repo, branch, options) {
  const { days, now, extraPrefixes } = options;
  if (retained(branch.name, repo.default_branch, extraPrefixes) || branch.protected !== false) return false;
  if (!/^[a-f0-9]{40}$/.test(branch.commit?.sha ?? '')) return false;
  const encoded = encodeURIComponent(branch.name);
  // Any applicable active rule retains the branch, including rules that permit bypass.
  if ((await api.get(`/rules/branches/${encoded}`)).length) return false;
  const commit = await api.get(`/commits/${branch.commit.sha}`);
  if (!oldEnough(commit.commit?.committer?.date, days, now) || !oldEnough(commit.commit?.author?.date, days, now)) return false;
  const merged = await api.list('/pulls', {
    state: 'closed', head: `${repo.owner.login}:${branch.name}`, base: repo.default_branch,
    sort: 'updated', direction: 'desc',
  });
  // Matching the exact head also supports squash/rebase merges. A newer tip is never removed.
  return merged.some((pr) => pr.head.repo?.id === repo.id && pr.head.ref === branch.name &&
    pr.base.ref === repo.default_branch && pr.head.sha === branch.commit.sha &&
    pr.merged_at && oldEnough(pr.merged_at, days, now));
}

export async function cleanupBranches(api, options, remove = deleteWithLease) {
  const repo = await api.get('');
  if (repo.archived || repo.disabled || repo.fork || !repo.default_branch) throw new Error('Repository is not eligible for cleanup.');
  const branches = await api.list('/branches');
  const active = openBranches(await api.list('/pulls', { state: 'open' }), repo.id);
  const candidates = [];
  const deleted = [];
  for (const branch of branches) {
    if (active.has(branch.name)) continue;
    if (await eligible(api, repo, branch, options)) candidates.push(branch);
  }
  // A surprising deletion count aborts the whole run instead of removing an arbitrary subset.
  if (candidates.length > options.maxDeletions) throw new Error('Deletion limit exceeded. Review candidates and adjust the limit.');
  for (const branch of candidates) {
    if (options.dryRun) continue;
    const currentRepo = await api.get('');
    if (currentRepo.default_branch !== repo.default_branch || currentRepo.archived || currentRepo.disabled) {
      throw new Error('Repository settings changed during cleanup.');
    }
    const current = await api.get(`/branches/${encodeURIComponent(branch.name)}`);
    if (current.commit.sha !== branch.commit.sha) continue;
    const currentActive = openBranches(await api.list('/pulls', { state: 'open' }), repo.id);
    if (currentActive.has(branch.name) || !await eligible(api, currentRepo, current, options)) continue;
    await remove(api, branch);
    deleted.push(branch);
  }
  return { candidates, deleted };
}

export async function deleteWithLease(api, branch) {
  const directory = await mkdtemp(join(tmpdir(), 'branch-cleanup-'));
  try {
    const auth = Buffer.from(`x-access-token:${api.token}`).toString('base64');
    // Credentials never appear in argv, a checkout, a credential helper, or an on-disk config.
    const env = {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0',
      GIT_CONFIG_COUNT: '2',
      GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader', GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${auth}`,
      GIT_CONFIG_KEY_1: 'credential.helper', GIT_CONFIG_VALUE_1: '',
    };
    delete env.GIT_CONFIG_PARAMETERS;
    await execute('git', ['init', '--bare', '--quiet', directory], { env, timeout: 30_000 });
    await execute('git', [
      '-C', directory, 'push', '--porcelain',
      `--force-with-lease=refs/heads/${branch.name}:${branch.commit.sha}`,
      `https://github.com/${api.repository}.git`, `:refs/heads/${branch.name}`,
    ], { env, timeout: 60_000 });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function main() {
  if (!['schedule', 'workflow_dispatch'].includes(process.env.GITHUB_EVENT_NAME)) {
    throw new Error('Cleanup requires a schedule or manual dispatch.');
  }
  const api = new GitHub(input('token'));
  const repo = await api.get('');
  if (process.env.GITHUB_REF !== `refs/heads/${repo.default_branch}`) throw new Error('Cleanup must run on the default branch.');
  const dryRun = boolean(input('dry-run', 'true'));
  const extraPrefixes = JSON.parse(input('keep-prefixes', '[]'));
  if (!Array.isArray(extraPrefixes) || extraPrefixes.some((p) => typeof p !== 'string' || !p.length)) throw new Error('Invalid keep-prefixes.');
  const result = await cleanupBranches(api, {
    dryRun, days: integer(input('minimum-age-days', '30'), 7, 3650), now: Date.now(),
    maxDeletions: integer(input('max-deletions', '10'), 1, 100), extraPrefixes,
  });
  output('candidates', result.candidates.map((b) => ({ name: b.name, sha: b.commit.sha })));
  output('deleted-count', result.deleted.length);
  summary('Branch cleanup', [
    dryRun ? 'Dry run: no branches were deleted.' : `Deleted ${result.deleted.length} branches.`, '',
    ...result.candidates.map((b) => `- ${escapeMarkdown(b.name)} (${b.commit.sha})`),
    ...(result.candidates.length ? [] : ['No eligible branches.']),
  ]);
  console.log(`${result.candidates.length} candidates; ${result.deleted.length} deleted.`);
}

runIfMain(import.meta, main);
