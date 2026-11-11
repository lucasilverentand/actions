import { evaluateJobs } from '../../lib/job-results.mjs';
import { boolean, input, output, runIfMain, summary } from '../../lib/runtime.mjs';
import { ReleaseApi, publishRelease } from '../../scripts/release/publisher.mjs';
import { planRelease } from '../../scripts/release/plan.mjs';

export async function runRelease(api, context, { dryRun = true, needs = {}, initialVersion = '1.0.0' } = {}) {
  if (!['push', 'workflow_dispatch'].includes(context.event) || !/^[a-f0-9]{40}$/.test(context.sha ?? '')) {
    throw new Error('Use a default-branch push or manual run at an exact commit.');
  }
  const repo = await api.request('GET', '');
  if (repo.archived || repo.disabled || repo.fork || context.ref !== `refs/heads/${repo.default_branch}`) {
    throw new Error('Release requires an active original repository and its default branch.');
  }
  const head = await api.request('GET', `/git/ref/heads/${encodeURIComponent(repo.default_branch)}`);
  if (head.object.sha !== context.sha) throw new Error('Default branch advanced; use a fresh run.');
  if (!dryRun && !evaluateJobs(needs).passed) throw new Error('Publication requires successful upstream verification jobs.');
  const plan = await planRelease(api, context.sha, { initialVersion });
  if (!plan) return { planned: false, created: false, version: '', tag: '', url: '', notes: '' };
  if (dryRun) return { ...plan, planned: true, created: false, url: '' };
  return { ...plan, ...await publishRelease(api, plan, context), planned: true };
}

export async function main() {
  const result = await runRelease(new ReleaseApi(input('token'), process.env.GITHUB_REPOSITORY), {
    event: process.env.GITHUB_EVENT_NAME, ref: process.env.GITHUB_REF, sha: process.env.GITHUB_SHA,
  }, {
    dryRun: boolean(input('dry-run', 'true')),
    needs: JSON.parse(input('needs', '{}')),
    initialVersion: input('initial-version', '1.0.0'),
  });
  for (const [key, value] of Object.entries(result)) output(key, value);
  summary('Semantic release', [result.planned
    ? `${result.tag}: ${result.created ? 'published' : 'preview or already published; no mutation'}.`
    : 'No unreleased commits.']);
}

runIfMain(import.meta, main);
