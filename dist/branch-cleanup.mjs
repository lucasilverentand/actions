// src/branch-cleanup.mjs
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

// src/github.mjs
var ApiError = class extends Error {
  constructor(status) {
    super(`GitHub API returned ${status}.`);
    this.status = status;
  }
};
var GitHub = class {
  constructor(token, repository = process.env.GITHUB_REPOSITORY, fetcher = fetch) {
    if (!token) throw new Error("A GitHub token is required.");
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? "")) {
      throw new Error("Expected owner/repository.");
    }
    if (process.env.GITHUB_API_URL && process.env.GITHUB_API_URL !== "https://api.github.com") {
      throw new Error("Only GitHub.com is supported.");
    }
    this.token = token;
    this.repository = repository;
    this.fetcher = fetcher;
  }
  async get(path, query = {}) {
    if (path !== "" && !path.startsWith("/")) throw new Error("Expected an API path.");
    const url = new URL(`https://api.github.com/repos/${this.repository}${path}`);
    url.search = new URLSearchParams(query).toString();
    const response = await this.fetcher(url, {
      headers: {
        authorization: `Bearer ${this.token}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "user-agent": "repository-hygiene-actions"
      },
      redirect: "error",
      signal: AbortSignal.timeout(3e4)
    });
    if (!response.ok) throw new ApiError(response.status);
    if (response.status === 204) return null;
    return response.json();
  }
  async list(path, query = {}) {
    const items = [];
    for (let page = 1; page <= 100; page++) {
      const batch = await this.get(path, { ...query, per_page: 100, page });
      if (!Array.isArray(batch)) throw new Error("Expected a paginated list.");
      items.push(...batch);
      if (batch.length < 100) return items;
    }
    throw new Error("Pagination limit reached; refusing an incomplete result.");
  }
  async file(path, ref) {
    const result = await this.get(`/contents/${path.split("/").map(encodeURIComponent).join("/")}`, { ref });
    if (result.type !== "file" || result.encoding !== "base64" || result.size > 1e6) {
      throw new Error("Unsupported file type or size.");
    }
    return Buffer.from(result.content, "base64").toString("utf8");
  }
};

// src/runtime.mjs
import { appendFileSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
function input(name, fallback = "") {
  return process.env[`INPUT_${name.replaceAll(" ", "_").toUpperCase()}`] ?? fallback;
}
function boolean(value) {
  if (value !== "true" && value !== "false") throw new Error("Expected true or false.");
  return value === "true";
}
function integer(value, min, max) {
  if (!/^\d+$/.test(value) || Number(value) < min || Number(value) > max) {
    throw new Error(`Expected an integer between ${min} and ${max}.`);
  }
  return Number(value);
}
function output(name, value) {
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${JSON.stringify(value)}
`);
  }
}
function summary(title, lines) {
  if (!process.env.GITHUB_STEP_SUMMARY) return;
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## ${title}

${lines.join("\n")}
`);
}
function escapeMarkdown(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("|", "&#124;").replaceAll("\r", " ").replaceAll("\n", " ").replaceAll("`", "&#96;").replaceAll("[", "&#91;").replaceAll("]", "&#93;");
}
function runIfMain(meta, fn) {
  if (process.argv[1] && meta.url === pathToFileURL(process.argv[1]).href) {
    fn().catch(() => {
      console.error("Action failed. Check its configuration, token permissions, and GitHub API availability.");
      process.exitCode = 1;
    });
  }
}

// src/branch-cleanup.mjs
var execute = promisify(execFile);
var keptNames = /* @__PURE__ */ new Set(["main", "master", "trunk", "dev", "develop", "development", "staging", "production", "gh-pages"]);
var keptPrefixes = ["release/", "releases/", "hotfix/"];
function retained(name, defaultBranch, extraPrefixes = []) {
  return name === defaultBranch || keptNames.has(name) || [...keptPrefixes, ...extraPrefixes].some((prefix) => name.startsWith(prefix));
}
function oldEnough(value, days, now) {
  const date = Date.parse(value);
  return Number.isFinite(date) && date <= now - days * 864e5;
}
function openBranches(pulls, repoId) {
  return new Set(pulls.flatMap((pr) => [pr.base.ref, ...pr.head.repo?.id === repoId ? [pr.head.ref] : []]));
}
async function eligible(api, repo, branch, options) {
  const { days, now, extraPrefixes } = options;
  if (retained(branch.name, repo.default_branch, extraPrefixes) || branch.protected !== false) return false;
  if (!/^[a-f0-9]{40}$/.test(branch.commit?.sha ?? "")) return false;
  const encoded = encodeURIComponent(branch.name);
  if ((await api.get(`/rules/branches/${encoded}`)).length) return false;
  const commit = await api.get(`/commits/${branch.commit.sha}`);
  if (!oldEnough(commit.commit?.committer?.date, days, now) || !oldEnough(commit.commit?.author?.date, days, now)) return false;
  const merged = await api.list("/pulls", {
    state: "closed",
    head: `${repo.owner.login}:${branch.name}`,
    base: repo.default_branch,
    sort: "updated",
    direction: "desc"
  });
  return merged.some((pr) => pr.head.repo?.id === repo.id && pr.head.ref === branch.name && pr.base.ref === repo.default_branch && pr.head.sha === branch.commit.sha && pr.merged_at && oldEnough(pr.merged_at, days, now));
}
async function cleanupBranches(api, options, remove = deleteWithLease) {
  const repo = await api.get("");
  if (repo.archived || repo.disabled || repo.fork || !repo.default_branch) throw new Error("Repository is not eligible for cleanup.");
  const branches = await api.list("/branches");
  const active = openBranches(await api.list("/pulls", { state: "open" }), repo.id);
  const candidates = [];
  const deleted = [];
  for (const branch of branches) {
    if (active.has(branch.name)) continue;
    if (await eligible(api, repo, branch, options)) candidates.push(branch);
  }
  if (candidates.length > options.maxDeletions) throw new Error("Deletion limit exceeded. Review candidates and adjust the limit.");
  for (const branch of candidates) {
    if (options.dryRun) continue;
    const currentRepo = await api.get("");
    if (currentRepo.default_branch !== repo.default_branch || currentRepo.archived || currentRepo.disabled) {
      throw new Error("Repository settings changed during cleanup.");
    }
    const current = await api.get(`/branches/${encodeURIComponent(branch.name)}`);
    if (current.commit.sha !== branch.commit.sha) continue;
    const currentActive = openBranches(await api.list("/pulls", { state: "open" }), repo.id);
    if (currentActive.has(branch.name) || !await eligible(api, currentRepo, current, options)) continue;
    await remove(api, branch);
    deleted.push(branch);
  }
  return { candidates, deleted };
}
async function deleteWithLease(api, branch) {
  const directory = await mkdtemp(join(tmpdir(), "branch-cleanup-"));
  try {
    const auth = Buffer.from(`x-access-token:${api.token}`).toString("base64");
    const env = {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_TERMINAL_PROMPT: "0",
      GIT_CONFIG_COUNT: "2",
      GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader",
      GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${auth}`,
      GIT_CONFIG_KEY_1: "credential.helper",
      GIT_CONFIG_VALUE_1: ""
    };
    delete env.GIT_CONFIG_PARAMETERS;
    await execute("git", ["init", "--bare", "--quiet", directory], { env, timeout: 3e4 });
    await execute("git", [
      "-C",
      directory,
      "push",
      "--porcelain",
      `--force-with-lease=refs/heads/${branch.name}:${branch.commit.sha}`,
      `https://github.com/${api.repository}.git`,
      `:refs/heads/${branch.name}`
    ], { env, timeout: 6e4 });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
async function main() {
  if (!["schedule", "workflow_dispatch"].includes(process.env.GITHUB_EVENT_NAME)) {
    throw new Error("Cleanup requires a schedule or manual dispatch.");
  }
  const api = new GitHub(input("token"));
  const repo = await api.get("");
  if (process.env.GITHUB_REF !== `refs/heads/${repo.default_branch}`) throw new Error("Cleanup must run on the default branch.");
  const dryRun = boolean(input("dry-run", "true"));
  const extraPrefixes = JSON.parse(input("keep-prefixes", "[]"));
  if (!Array.isArray(extraPrefixes) || extraPrefixes.some((p) => typeof p !== "string" || !p.length)) throw new Error("Invalid keep-prefixes.");
  const result = await cleanupBranches(api, {
    dryRun,
    days: integer(input("minimum-age-days", "30"), 7, 3650),
    now: Date.now(),
    maxDeletions: integer(input("max-deletions", "10"), 1, 100),
    extraPrefixes
  });
  output("candidates", result.candidates.map((b) => ({ name: b.name, sha: b.commit.sha })));
  output("deleted-count", result.deleted.length);
  summary("Branch cleanup", [
    dryRun ? "Dry run: no branches were deleted." : `Deleted ${result.deleted.length} branches.`,
    "",
    ...result.candidates.map((b) => `- ${escapeMarkdown(b.name)} (${b.commit.sha})`),
    ...result.candidates.length ? [] : ["No eligible branches."]
  ]);
  console.log(`${result.candidates.length} candidates; ${result.deleted.length} deleted.`);
}
runIfMain(import.meta, main);
export {
  cleanupBranches,
  deleteWithLease,
  eligible,
  main,
  oldEnough,
  openBranches,
  retained
};
