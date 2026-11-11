export function parseVersion(version) {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(version ?? '');
  if (!match || match.slice(1).some((part) => !Number.isSafeInteger(Number(part)))) {
    throw new Error('Use a stable semantic version such as 1.2.3.');
  }
  return match.slice(1).map(Number);
}

export function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  for (let index = 0; index < 3; index++) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  }
  return 0;
}

export function bumpVersion(version, level) {
  const index = ['major', 'minor', 'patch'].indexOf(level);
  if (index === -1) throw new Error('Choose major, minor, or patch.');
  const parts = parseVersion(version);
  parts[index]++;
  parts.fill(0, index + 1);
  const next = parts.join('.');
  parseVersion(next);
  return next;
}

export function analyzeCommits(commits) {
  if (!commits.length) return null;
  let level = 'patch';
  for (const commit of commits) {
    const message = commit.commit?.message;
    const header = /^([a-z]+)(?:\([^\r\n)]+\))?(!)?: ([^\r\n]+)/.exec(message ?? '');
    if (!header) throw new Error('A merged commit is not a Conventional Commit; review its title before releasing.');
    if (header[2] || /^BREAKING[ -]CHANGE:\s*\S/m.test(message)) level = 'major';
    else if (header[1] === 'feat' && level !== 'major') level = 'minor';
  }
  return level;
}
