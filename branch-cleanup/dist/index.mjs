import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);

// branch-cleanup/src/index.mjs
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

// lib/network.mjs
import * as http from "node:http";
var configured = false;
function configureProxy(env = process.env, configure = http.setGlobalProxyFromEnv) {
  if (configured || !["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"].some((key) => env[key])) return;
  if (typeof configure !== "function") {
    if (env.NODE_USE_ENV_PROXY === "1") {
      configured = true;
      return;
    }
    throw new Error("Proxy runners require Node 24.14+ or NODE_USE_ENV_PROXY=1 at runner startup.");
  }
  configure(env);
  configured = true;
}

// lib/github.mjs
var ApiError = class extends Error {
  constructor(status) {
    super(`GitHub API returned ${status}.`);
    this.name = "ApiError";
    this.status = status;
  }
};
var GitHub = class {
  constructor(token, repository = process.env.GITHUB_REPOSITORY, fetcher = fetch) {
    configureProxy();
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
  // Read-only tokens do not receive merge settings from the REST repository response; GraphQL returns them.
  async mergeSettings() {
    const [owner, name] = this.repository.split("/");
    const response = await this.fetcher(new URL("https://api.github.com/graphql"), {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.token}`,
        accept: "application/vnd.github+json",
        "content-type": "application/json",
        "user-agent": "repository-hygiene-actions"
      },
      body: JSON.stringify({
        query: "query($owner:String!,$name:String!){repository(owner:$owner,name:$name){deleteBranchOnMerge mergeCommitAllowed squashMergeAllowed rebaseMergeAllowed squashMergeCommitTitle squashMergeCommitMessage}}",
        variables: { owner, name }
      }),
      redirect: "error",
      signal: AbortSignal.timeout(3e4)
    });
    if (!response.ok) throw new ApiError(response.status);
    const settings = (await response.json())?.data?.repository;
    if (typeof settings?.deleteBranchOnMerge !== "boolean") throw new Error("Merge settings are unavailable.");
    return {
      delete_branch_on_merge: settings.deleteBranchOnMerge,
      allow_merge_commit: settings.mergeCommitAllowed,
      allow_squash_merge: settings.squashMergeAllowed,
      allow_rebase_merge: settings.rebaseMergeAllowed,
      squash_merge_commit_title: settings.squashMergeCommitTitle,
      squash_merge_commit_message: settings.squashMergeCommitMessage
    };
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

// lib/concurrency.mjs
async function mapConcurrent(items, concurrency, mapper) {
  if (!Array.isArray(items) || !Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16 || typeof mapper !== "function") {
    throw new Error("Invalid concurrent inspection configuration.");
  }
  const results = new Array(items.length);
  let next = 0;
  let failed = false;
  async function worker() {
    while (!failed && next < items.length) {
      const index = next++;
      try {
        results[index] = await mapper(items[index], index);
      } catch {
        failed = true;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  if (failed) throw new Error("Concurrent inspection failed. Verify access and API availability.");
  return results;
}

// lib/runtime.mjs
import { appendFileSync, readFileSync, realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { EOL } from "node:os";
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
  if (!/^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(name)) throw new Error("Invalid output name.");
  if (process.env.GITHUB_OUTPUT) {
    const text = typeof value === "string" ? value : JSON.stringify(value);
    if (text === void 0) throw new Error("Undefined output value.");
    const delimiter = `output_${randomUUID()}`;
    appendFileSync(process.env.GITHUB_OUTPUT, /[\r\n]/.test(text) ? `${name}<<${delimiter}${EOL}${text}${EOL}${delimiter}${EOL}` : `${name}=${text}${EOL}`);
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
var genericFailure = "Action failed. Check its configuration, token permissions, and GitHub API availability.";
var platformErrorKeys = ["code", "errno", "syscall", "path", "cmd", "stdout", "stderr", "cause", "errors"];
function failureMessage(error) {
  const own = error instanceof Error && (Object.getPrototypeOf(error) === Error.prototype || error.name === "ApiError") && !platformErrorKeys.some((key) => Object.hasOwn(error, key));
  const message = own ? String(error.message).replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/gu, " ").trim().slice(0, 300) : "";
  return `::error::${(message || genericFailure).replaceAll("%", "%25")}`;
}
function runIfMain(meta, fn) {
  if (process.argv[1] && meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
    fn().catch((error) => {
      console.error(failureMessage(error));
      process.exitCode = 1;
    });
  }
}

// branch-cleanup/src/index.mjs
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
  const selected = await mapConcurrent(branches, options.concurrency ?? 4, async (branch) => !active.has(branch.name) && await eligible(api, repo, branch, options));
  const candidates = branches.filter((_, index) => selected[index]);
  const deleted = [];
  if (!options.dryRun && candidates.length > options.maxDeletions) throw new Error("Deletion limit exceeded. Review candidates and adjust the limit.");
  for (const branch of candidates) {
    if (options.dryRun) continue;
    const currentRepo = await api.get("");
    if (currentRepo.default_branch !== repo.default_branch || currentRepo.archived || currentRepo.disabled || currentRepo.fork) {
      throw new Error("Repository settings changed during cleanup.");
    }
    const current = await api.get(`/branches/${encodeURIComponent(branch.name)}`);
    if (current.commit.sha !== branch.commit.sha) continue;
    const relatedPulls = await Promise.all([
      api.list("/pulls", { state: "open", head: `${repo.owner.login}:${branch.name}` }),
      api.list("/pulls", { state: "open", base: branch.name })
    ]);
    const currentActive = openBranches(relatedPulls.flat(), repo.id);
    if (currentActive.has(branch.name) || !await eligible(api, currentRepo, current, options)) continue;
    await remove(api, branch);
    deleted.push(branch);
  }
  return { candidates, deleted };
}
async function deleteWithLease(api, branch, executeGit = execute) {
  const directory = await mkdtemp(join(tmpdir(), "branch-cleanup-"));
  try {
    const emptyConfig = join(directory, "empty-global-config");
    await writeFile(emptyConfig, "", { mode: 384, flag: "wx" });
    const auth = Buffer.from(`x-access-token:${api.token}`).toString("base64");
    const env = {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: emptyConfig,
      GIT_TERMINAL_PROMPT: "0",
      GIT_CONFIG_COUNT: "2",
      GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader",
      GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${auth}`,
      GIT_CONFIG_KEY_1: "credential.helper",
      GIT_CONFIG_VALUE_1: ""
    };
    for (const key of [
      "GIT_DIR",
      "GIT_COMMON_DIR",
      "GIT_WORK_TREE",
      "GIT_INDEX_FILE",
      "GIT_OBJECT_DIRECTORY",
      "GIT_ALTERNATE_OBJECT_DIRECTORIES",
      "GIT_NAMESPACE",
      "GIT_PREFIX",
      "GIT_CONFIG",
      "GIT_CONFIG_PARAMETERS",
      "GIT_TEMPLATE_DIR"
    ]) delete env[key];
    const version = /git version (\d+)\.(\d+)/.exec((await executeGit("git", ["--version"], { env, timeout: 3e4 })).stdout);
    if (!version || Number(version[1]) < 2 || Number(version[1]) === 2 && Number(version[2]) < 31) {
      throw new Error("Branch deletion requires Git 2.31 or newer for environment-only authentication.");
    }
    const transportEnv = { ...process.env };
    for (const key of Object.keys(transportEnv)) {
      if (/^GIT_(?:DIR|COMMON_DIR|WORK_TREE|INDEX_FILE|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|NAMESPACE|PREFIX|CONFIG(?:_COUNT|_KEY_\d+|_VALUE_\d+|_PARAMETERS)?|TEMPLATE_DIR)$/.test(key)) delete transportEnv[key];
    }
    for (const key of ["http.sslCAInfo", "http.sslCAPath", "http.sslBackend", "http.proxy"]) {
      let value;
      try {
        value = (await executeGit(
          "git",
          ["config", "--get-urlmatch", key, `https://github.com/${api.repository}.git`],
          { cwd: directory, env: transportEnv, timeout: 3e4 }
        )).stdout.trim();
      } catch (error) {
        if (error.code === 1) continue;
        throw error;
      }
      if (!value) continue;
      if (/[\r\n\0]/.test(value)) throw new Error("Invalid runner transport configuration.");
      const index = Number(env.GIT_CONFIG_COUNT);
      env[`GIT_CONFIG_KEY_${index}`] = key;
      env[`GIT_CONFIG_VALUE_${index}`] = value;
      env.GIT_CONFIG_COUNT = String(index + 1);
    }
    await executeGit("git", ["init", "--bare", "--template=", "--quiet", directory], { env, timeout: 3e4 });
    await executeGit("git", [
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
  const maxDeletions = integer(input("max-deletions", "10"), 1, 100);
  const extraPrefixes = JSON.parse(input("keep-prefixes", "[]"));
  if (!Array.isArray(extraPrefixes) || extraPrefixes.some((p) => typeof p !== "string" || !p.length)) throw new Error("Invalid keep-prefixes.");
  const result = await cleanupBranches(api, {
    dryRun,
    days: integer(input("minimum-age-days", "30"), 7, 3650),
    now: Date.now(),
    maxDeletions,
    extraPrefixes,
    concurrency: integer(input("inspection-concurrency", "4"), 1, 8)
  });
  output("candidates", result.candidates.map((b) => ({ name: b.name, sha: b.commit.sha })));
  output("candidate-count", result.candidates.length);
  output("deleted-count", result.deleted.length);
  summary("Branch cleanup", [
    dryRun ? "Dry run: no branches were deleted." : `Deleted ${result.deleted.length} branches.`,
    "",
    ...dryRun && result.candidates.length > maxDeletions ? ["The candidate count exceeds max-deletions. A deletion run would stop before deleting any branches.", ""] : [],
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
