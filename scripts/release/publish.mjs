import { appendFile } from 'node:fs/promises';
import { runIfMain } from '../../lib/runtime.mjs';
import { compareVersions, parseVersion, readMetadata } from './metadata.mjs';

export class ReleaseApi {
  constructor(token, repository) {
    if (!token || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? '')) throw new Error('Missing release credentials or repository.');
    if (process.env.GITHUB_API_URL && process.env.GITHUB_API_URL !== 'https://api.github.com') throw new Error('Only GitHub.com is supported.');
    this.token = token;
    this.repository = repository;
  }

  async request(method, path, body) {
    const response = await fetch(`https://api.github.com/repos/${this.repository}${path}`, {
      method, redirect: 'error', signal: AbortSignal.timeout(30_000),
      headers: {
        authorization: `Bearer ${this.token}`, accept: 'application/vnd.github+json',
        'content-type': 'application/json', 'x-github-api-version': '2022-11-28',
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) throw Object.assign(new Error(`Release API returned ${response.status}.`), { status: response.status });
    return response.json();
  }
}

async function optional(api, path) {
  try { return await api.request('GET', path); }
  catch (error) { if (error.status === 404) return null; throw error; }
}

export async function publishRelease(api, metadata, context) {
  const { version, tag, notes } = metadata;
  parseVersion(version);
  if (tag !== `v${version}` || notes.trim().length < 20) throw new Error('Invalid release metadata.');
  if (!['push', 'workflow_dispatch'].includes(context.event) || !/^[a-f0-9]{40}$/.test(context.sha ?? '')) {
    throw new Error('Releases require a verified push or manual run.');
  }
  const repo = await api.request('GET', '');
  if (context.ref !== `refs/heads/${repo.default_branch}`) throw new Error('Release only from the default branch.');
  const branchPath = `/git/ref/heads/${encodeURIComponent(repo.default_branch)}`;
  const head = await api.request('GET', branchPath);
  if (head.object.sha !== context.sha) throw new Error('Default branch advanced; release from a fresh verified run.');

  let complete = false;
  for (let page = 1; page <= 100; page++) {
    const releases = await api.request('GET', `/releases?per_page=100&page=${page}`);
    if (!Array.isArray(releases)) throw new Error('Invalid release inventory.');
    for (const release of releases) {
      if (release.draft || release.prerelease || !/^v\d+\.\d+\.\d+$/.test(release.tag_name)) continue;
      if (compareVersions(version, release.tag_name.slice(1)) < 0) throw new Error('Version is older than a published stable release.');
    }
    if (releases.length < 100) { complete = true; break; }
  }
  if (!complete) throw new Error('Incomplete release inventory.');

  // Published versions are immutable. Ordinary pushes between releases are a no-op.
  const existing = await optional(api, `/releases/tags/${tag}`);
  if (existing) {
    if (existing.draft || existing.prerelease) throw new Error('An unfinished release already uses this version.');
    return { created: false, tag, url: existing.html_url };
  }

  let ref = await optional(api, `/git/ref/tags/${tag}`);
  if (ref) {
    let object = ref.object;
    for (let depth = 0; object.type === 'tag' && depth < 10; depth++) {
      object = (await api.request('GET', `/git/tags/${object.sha}`)).object;
    }
    if (object.type !== 'commit' || object.sha !== context.sha) throw new Error('Existing tag points to another commit; never move a version tag.');
  }
  // Recheck after inventory requests, before the first mutation.
  if ((await api.request('GET', branchPath)).object.sha !== context.sha) throw new Error('Default branch advanced during release preparation.');
  if (!ref) await api.request('POST', '/git/refs', { ref: `refs/tags/${tag}`, sha: context.sha });
  const release = await api.request('POST', '/releases', {
    tag_name: tag, target_commitish: context.sha, name: tag, body: notes,
    draft: false, prerelease: false, generate_release_notes: false, make_latest: 'true',
  });
  return { created: true, tag, url: release.html_url };
}

export async function main() {
  const api = new ReleaseApi(process.env.GH_TOKEN, process.env.GITHUB_REPOSITORY);
  const result = await publishRelease(api, await readMetadata(), {
    event: process.env.GITHUB_EVENT_NAME, ref: process.env.GITHUB_REF, sha: process.env.GITHUB_SHA,
  });
  console.log(`${result.tag}: ${result.created ? 'published' : 'already published; no changes'}.`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY, `## Release\n\n${result.tag}: ${result.created ? 'published' : 'already published; no changes'}.\n`);
  }
}

runIfMain(import.meta, main);
