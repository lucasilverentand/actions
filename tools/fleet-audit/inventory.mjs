export async function ownedRepositories(get) {
  let login;
  let installation = false;
  try { login = (await get('/user')).login; }
  catch (error) {
    if (error.status !== 403) throw error;
    installation = true;
  }
  const repositories = [];
  for (let page = 1; page <= 100; page++) {
    const response = await get(installation ? `/installation/repositories?per_page=100&page=${page}`
      : `/user/repos?affiliation=owner&per_page=100&page=${page}`);
    const batch = installation ? response.repositories : response;
    if (!Array.isArray(batch)) throw new Error('Invalid inventory.');
    for (const repo of batch) {
      if (installation ? repo.owner.type !== 'User' : repo.owner.login !== login) continue;
      if (!repo.archived && !repo.disabled && !repo.fork) repositories.push(repo);
    }
    if (batch.length < 100) return repositories;
  }
  throw new Error('Incomplete inventory.');
}
