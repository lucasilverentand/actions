import { evaluateJobs } from '../../lib/job-results.mjs';
import { boolean, input, output, runIfMain, summary } from '../../lib/runtime.mjs';
import { ReleaseApi, publishRelease, supersededBy } from '../../scripts/release/publisher.mjs';
import { planRelease } from '../../scripts/release/plan.mjs';

const unchanged = { planned: false, created: false, superseded: false, version: '', tag: '', url: '', notes: '' };

export async function runRelease(api, context, { dryRun = true, needs = {}, initialVersion = '1.0.0' } = {}) {
  if (!['push', 'workflow_dispatch'].includes(context.event) || !/^[a-f0-9]{40}$/.test(context.sha ?? '')) {
    throw new Error('Use a default-branch push or manual run at an exact commit.');
  }
  const repo = await api.request('GET', '');
  if (repo.archived || repo.disabled || repo.fork || context.ref !== `refs/heads/${repo.default_branch}`) {
    throw new Error('Release requires an active original repository and its default branch.');
  }
  const head = await api.request('GET', `/git/ref/heads/${encodeURIComponent(repo.default_branch)}`);
  // A queued newer run covers this commit. Stop successfully instead of failing an older, valid commit.
  if (head.object?.sha !== context.sha && await supersededBy(api, context.sha, head.object?.sha)) {
    return { ...unchanged, superseded: true };
  }
  if (!dryRun && !evaluateJobs(needs).passed) throw new Error('Publication requires successful upstream verification jobs.');
  const plan = await planRelease(api, context.sha, { initialVersion });
  if (!plan) return unchanged;
  if (dryRun) return { ...unchanged, ...plan, planned: true };
  const published = await publishRelease(api, plan, context);
  if (published.superseded) return { ...unchanged, superseded: true };
  return { ...unchanged, ...plan, ...published, planned: true };
}

export function releaseSummary(result) {
  if (result.superseded) return 'Superseded: the default branch moved to a newer commit. That run plans and publishes this commit; nothing was written.';
  if (!result.planned) return 'No unreleased commits.';
  return `${result.tag}: ${result.created ? 'published' : 'preview or already published; no mutation'}.`;
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
  summary('Semantic release', [releaseSummary(result)]);
  console.log(releaseSummary(result));
}

runIfMain(import.meta, main);
