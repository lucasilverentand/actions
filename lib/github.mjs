import { configureProxy } from './network.mjs';

export class ApiError extends Error {
  constructor(status) {
    super(`GitHub API returned ${status}.`);
    this.name = 'ApiError';
    this.status = status;
  }
}

export class GitHub {
  constructor(token, repository = process.env.GITHUB_REPOSITORY, fetcher = fetch) {
    configureProxy();
    if (!token) throw new Error('A GitHub token is required.');
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? '')) {
      throw new Error('Expected owner/repository.');
    }
    // Restrict credential destinations. GitHub Enterprise is not supported yet.
    if (process.env.GITHUB_API_URL && process.env.GITHUB_API_URL !== 'https://api.github.com') {
      throw new Error('Only GitHub.com is supported.');
    }
    this.token = token;
    this.repository = repository;
    this.fetcher = fetcher;
  }

  async get(path, query = {}) {
    if (path !== '' && !path.startsWith('/')) throw new Error('Expected an API path.');
    const url = new URL(`https://api.github.com/repos/${this.repository}${path}`);
    url.search = new URLSearchParams(query).toString();
    const response = await this.fetcher(url, {
      headers: {
        authorization: `Bearer ${this.token}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        'user-agent': 'repository-hygiene-actions',
      },
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new ApiError(response.status);
    if (response.status === 204) return null;
    return response.json();
  }

  // Read-only tokens do not receive merge settings from the REST repository response; GraphQL returns them.
  async mergeSettings() {
    const [owner, name] = this.repository.split('/');
    const response = await this.fetcher(new URL('https://api.github.com/graphql'), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.token}`,
        accept: 'application/vnd.github+json',
        'content-type': 'application/json',
        'user-agent': 'repository-hygiene-actions',
      },
      body: JSON.stringify({
        query: 'query($owner:String!,$name:String!){repository(owner:$owner,name:$name){deleteBranchOnMerge mergeCommitAllowed squashMergeAllowed rebaseMergeAllowed squashMergeCommitTitle squashMergeCommitMessage}}',
        variables: { owner, name },
      }),
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new ApiError(response.status);
    const settings = (await response.json())?.data?.repository;
    if (typeof settings?.deleteBranchOnMerge !== 'boolean') throw new Error('Merge settings are unavailable.');
    return {
      delete_branch_on_merge: settings.deleteBranchOnMerge,
      allow_merge_commit: settings.mergeCommitAllowed,
      allow_squash_merge: settings.squashMergeAllowed,
      allow_rebase_merge: settings.rebaseMergeAllowed,
      squash_merge_commit_title: settings.squashMergeCommitTitle,
      squash_merge_commit_message: settings.squashMergeCommitMessage,
    };
  }

  async list(path, query = {}) {
    const items = [];
    for (let page = 1; page <= 100; page++) {
      const batch = await this.get(path, { ...query, per_page: 100, page });
      if (!Array.isArray(batch)) throw new Error('Expected a paginated list.');
      items.push(...batch);
      if (batch.length < 100) return items;
    }
    throw new Error('Pagination limit reached; refusing an incomplete result.');
  }

  async file(path, ref) {
    const result = await this.get(`/contents/${path.split('/').map(encodeURIComponent).join('/')}`, { ref });
    if (result.type !== 'file' || result.encoding !== 'base64' || result.size > 1_000_000) {
      throw new Error('Unsupported file type or size.');
    }
    return Buffer.from(result.content, 'base64').toString('utf8');
  }
}
