import { parseRules, parseTrustedOwners } from '../../lib/rules.mjs';

function validateOrganization(organization) {
  if (typeof organization !== 'string' || !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(organization)) {
    throw new Error('Expected a GitHub organization login.');
  }
}

export function inventoryOptions(args) {
  const options = {};
  const seen = new Set();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!value || seen.has(flag)) throw new Error('Supply each inventory option once with a value.');
    seen.add(flag);
    if (flag === '--org') {
      validateOrganization(value);
      options.organization = value;
    } else if (flag === '--rules') {
      options.rules = parseRules(value);
    } else if (flag === '--trusted-owners') {
      options.trustedOwners = parseTrustedOwners(value);
    } else if (flag === '--concurrency' && /^[1-4]$/.test(value)) {
      options.concurrency = Number(value);
    } else throw new Error('Use --org ORGANIZATION and optionally --concurrency 1–4.');
  }
  return options;
}

export async function ownedRepositories(get, { organization } = {}) {
  if (organization !== undefined) validateOrganization(organization);
  let login;
  let installation = false;
  try {
    login = (await get('/user')).login;
    if (typeof login !== 'string' || !login.trim()) throw new Error('Invalid authenticated account.');
  }
  catch (error) {
    if (error.status !== 403) throw error;
    installation = true;
  }
  const repositories = [];
  let matchedOwner = false;
  let inspectedCount = 0;
  let installationCount;
  const seenNames = new Set();
  const seenIds = new Set();
  for (let page = 1; page <= 100; page++) {
    const response = await get(installation ? `/installation/repositories?per_page=100&page=${page}`
      : organization ? `/orgs/${organization}/repos?type=all&per_page=100&page=${page}`
        : `/user/repos?affiliation=owner&per_page=100&page=${page}`);
    const batch = installation ? response.repositories : response;
    if (!Array.isArray(batch)) throw new Error('Invalid inventory.');
    if (installation && response.total_count !== undefined) {
      if (!Number.isSafeInteger(response.total_count) || response.total_count < 0 ||
          (installationCount !== undefined && installationCount !== response.total_count)) {
        throw new Error('Installation inventory changed or is invalid.');
      }
      installationCount = response.total_count;
    }
    inspectedCount += batch.length;
    for (const repo of batch) {
      if (typeof repo.full_name !== 'string' || seenNames.has(repo.full_name.toLowerCase()) ||
          (repo.id !== undefined && seenIds.has(repo.id))) throw new Error('Duplicate or invalid repository inventory.');
      seenNames.add(repo.full_name.toLowerCase());
      if (repo.id !== undefined) seenIds.add(repo.id);
      const matches = organization
        ? repo.owner.type === 'Organization' && repo.owner.login.toLowerCase() === organization.toLowerCase()
        : installation ? repo.owner.type === 'User' : repo.owner.login === login;
      if (!matches) continue;
      matchedOwner = true;
      if (!repo.archived && !repo.disabled && !repo.fork) repositories.push(repo);
    }
    if (batch.length < 100) {
      if (installationCount !== undefined && inspectedCount !== installationCount) throw new Error('Incomplete installation inventory.');
      if (installation && !matchedOwner && (organization || inspectedCount)) throw new Error('The installation has no repositories for the requested scope.');
      return repositories;
    }
  }
  throw new Error('Incomplete inventory.');
}
