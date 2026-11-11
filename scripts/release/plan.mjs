import { escapeMarkdown } from '../../lib/runtime.mjs';
import { analyzeCommits, bumpVersion, compareVersions, parseVersion } from './metadata.mjs';

export async function stableReleases(api) {
  const result = [];
  for (let page = 1; page <= 100; page++) {
    const batch = await api.request('GET', `/releases?per_page=100&page=${page}`);
    if (!Array.isArray(batch)) throw new Error('Invalid release inventory.');
    for (const release of batch) {
      if (release.draft || release.prerelease || !/^v\d+\.\d+\.\d+$/.test(release.tag_name)) continue;
      parseVersion(release.tag_name.slice(1));
      result.push(release);
    }
    if (batch.length < 100) return result;
  }
  throw new Error('Incomplete release inventory.');
}

export async function planRelease(api, sha) {
  if (!/^[a-f0-9]{40}$/.test(sha ?? '')) throw new Error('Expected an exact release commit.');
  const releases = await stableReleases(api);
  const latest = releases.sort((a, b) => compareVersions(b.tag_name.slice(1), a.tag_name.slice(1)))[0];
  const commits = [];
  let complete = false;
  let total;
  for (let page = 1; page <= 100; page++) {
    let batch;
    if (latest) {
      const comparison = await api.request('GET', `/compare/${encodeURIComponent(latest.tag_name)}...${sha}?per_page=100&page=${page}`);
      if (!['ahead', 'identical'].includes(comparison.status) || !Number.isSafeInteger(comparison.total_commits) || comparison.total_commits < 0) {
        throw new Error('Release history is divergent or incomplete.');
      }
      if (page > 1 && total !== comparison.total_commits) throw new Error('Release comparison changed during pagination.');
      total = comparison.total_commits;
      batch = comparison.commits;
    } else {
      batch = await api.request('GET', `/commits?sha=${sha}&per_page=100&page=${page}`);
    }
    if (!Array.isArray(batch)) throw new Error('Invalid commit inventory.');
    commits.push(...batch);
    if (batch.length < 100) { complete = true; break; }
  }
  if (!complete || (latest && commits.length !== total)) throw new Error('Incomplete commit inventory.');
  if (new Set(commits.map((commit) => commit.sha)).size !== commits.length ||
      commits.some((commit) => !/^[a-f0-9]{40}$/.test(commit.sha ?? ''))) throw new Error('Invalid or duplicate commits.');
  const level = analyzeCommits(commits);
  if (!level) return null;
  const version = latest ? bumpVersion(latest.tag_name.slice(1), level) : '1.0.0';
  const notes = '## Changes\n\n' + commits.map((commit) =>
    `- ${escapeMarkdown(commit.commit.message.split(/\r?\n/)[0])} (${commit.sha.slice(0, 7)})`).join('\n');
  return { version, tag: `v${version}`, notes };
}
