function validateOrganization(organization) {
  if (typeof organization !== 'string' || !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(organization)) {
    throw new Error('Expected a GitHub organization login.');
  }
}

export function inventoryOptions(args) {
  if (!args.length) return {};
  if (args.length !== 2 || args[0] !== '--org') throw new Error('Use --org ORGANIZATION or omit it for personal repositories.');
  validateOrganization(args[1]);
  return { organization: args[1] };
}

export async function ownedRepositories(get, { organization } = {}) {
  if (organization !== undefined) validateOrganization(organization);
  let login;
  let installation = false;
  try { login = (await get('/user')).login; }
  catch (error) {
    if (error.status !== 403) throw error;
    installation = true;
  }
  const repositories = [];
  let matchedOwner = false;
  for (let page = 1; page <= 100; page++) {
    const response = await get(installation ? `/installation/repositories?per_page=100&page=${page}`
      : organization ? `/orgs/${organization}/repos?type=all&per_page=100&page=${page}`
        : `/user/repos?affiliation=owner&per_page=100&page=${page}`);
    const batch = installation ? response.repositories : response;
    if (!Array.isArray(batch)) throw new Error('Invalid inventory.');
    for (const repo of batch) {
      const matches = organization
        ? repo.owner.type === 'Organization' && repo.owner.login.toLowerCase() === organization.toLowerCase()
        : installation ? repo.owner.type === 'User' : repo.owner.login === login;
      if (!matches) continue;
      matchedOwner = true;
      if (!repo.archived && !repo.disabled && !repo.fork) repositories.push(repo);
    }
    if (batch.length < 100) {
      if (organization && installation && !matchedOwner) throw new Error('The installation has no repositories for the requested organization.');
      return repositories;
    }
  }
  throw new Error('Incomplete inventory.');
}
