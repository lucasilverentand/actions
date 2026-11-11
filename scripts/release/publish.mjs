import { appendFile } from 'node:fs/promises';
import { runIfMain } from '../../lib/runtime.mjs';
import { planRelease } from './plan.mjs';
import { ReleaseApi, publishRelease } from './publisher.mjs';
export { ReleaseApi, publishRelease } from './publisher.mjs';

export async function main() {
  const api = new ReleaseApi(process.env.GH_TOKEN, process.env.GITHUB_REPOSITORY);
  const context = {
    event: process.env.GITHUB_EVENT_NAME, ref: process.env.GITHUB_REF, sha: process.env.GITHUB_SHA,
  };
  const metadata = await planRelease(api, context.sha);
  if (!metadata) {
    console.log('No unreleased commits; no version changes.');
    if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, '## Release\n\nNo unreleased commits; no version changes.\n');
    return;
  }
  const result = await publishRelease(api, metadata, context);
  console.log(`${result.tag}: ${result.created ? 'published' : 'already published; no changes'}.`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY, `## Release\n\n${result.tag}: ${result.created ? 'published' : 'already published; no changes'}.\n`);
  }
}

runIfMain(import.meta, main);
