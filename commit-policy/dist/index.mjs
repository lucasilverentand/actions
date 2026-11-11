import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);

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

// lib/commit-policy.mjs
var types = ["feat", "fix", "docs", "style", "refactor", "perf", "test", "build", "ci", "chore", "revert"];
function checkSubject(subject, { maxSubjectLength = 100, maxSummaryLength = 72, allowScopes = true } = {}) {
  if (typeof subject !== "string") return ["Provide a Conventional Commit subject."];
  const findings = [];
  const match = /^([a-z]+)(?:\(([a-zA-Z0-9][a-zA-Z0-9._/-]*)\))?(!)?: (\S(?:.*\S)?)$/u.exec(subject);
  if (!match || !types.includes(match[1]) || /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/u.test(subject)) {
    findings.push("Use a Conventional Commit subject, for example: fix: handle empty input.");
  }
  if ([...subject].length > maxSubjectLength) findings.push(`Keep the subject within ${maxSubjectLength} characters.`);
  if (subject !== subject.trim()) findings.push("Remove whitespace around the subject.");
  if (match && [...match[4]].length > maxSummaryLength) findings.push(`Keep the summary after the type within ${maxSummaryLength} characters.`);
  if (match?.[2] && !allowScopes) findings.push("Scopes are disabled by this repository policy.");
  return findings;
}
function checkCommitMessage(message, options) {
  if (typeof message !== "string") return ["Commit message could not be inspected."];
  const lines = message.replaceAll("\r\n", "\n").split("\n");
  const findings = checkSubject(lines[0], options);
  if (lines.slice(1).some((line) => line.trim()) && lines[1].trim()) {
    findings.push("Separate a nonempty commit body from its subject with a blank line.");
  }
  return findings;
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
function event() {
  return JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
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
function runIfMain(meta, fn) {
  if (process.argv[1] && meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
    fn().catch(() => {
      console.error("Action failed. Check its configuration, token permissions, and GitHub API availability.");
      process.exitCode = 1;
    });
  }
}

// commit-policy/src/index.mjs
var sha = /^[a-f0-9]{40}$/;
var zero = "0".repeat(40);
function commitRange(payload, eventName, repository) {
  if (payload.repository?.full_name?.toLowerCase() !== repository.toLowerCase()) throw new Error("Event repository mismatch.");
  let before;
  let after;
  if (eventName === "pull_request") {
    const pr = payload.pull_request;
    if (pr?.base?.repo?.full_name?.toLowerCase() !== repository.toLowerCase()) throw new Error("PR base repository mismatch.");
    before = pr.base.sha;
    after = pr.head?.sha;
  } else if (eventName === "push") {
    if (!payload.ref?.startsWith("refs/heads/")) throw new Error("Only branch push events are supported.");
    if (payload.deleted === true && payload.after === zero) return null;
    before = payload.before;
    after = payload.after;
    if (before === zero) throw new Error("New branch pushes have no comparison base; use pull_request or an existing branch push.");
  } else throw new Error("Use commit-policy on pull_request or push events.");
  if (!sha.test(before ?? "") || !sha.test(after ?? "") || before === zero || after === zero) throw new Error("Missing immutable comparison SHAs.");
  return { before, after };
}
async function readCommits(api, range, maxCommits = 250) {
  if (!Number.isSafeInteger(maxCommits) || maxCommits < 1 || maxCommits > 1e3) throw new Error("Invalid commit limit.");
  if (!range) return [];
  const { before, after } = range;
  if (!sha.test(before ?? "") || !sha.test(after ?? "")) throw new Error("Expected full commit SHAs.");
  const commits = [];
  let total;
  for (let page = 1; page <= Math.ceil(maxCommits / 100); page++) {
    const result = await api.get(`/compare/${before}...${after}`, { per_page: 100, page });
    if (!Number.isSafeInteger(result.total_commits) || result.total_commits < 0 || result.total_commits > maxCommits) {
      throw new Error("Commit range is incomplete or exceeds max-commits.");
    }
    if (page === 1) total = result.total_commits;
    if (result.total_commits !== total || result.base_commit?.sha !== before || !Array.isArray(result.commits)) {
      throw new Error("Comparison metadata changed or is incomplete.");
    }
    if (result.commits.length !== Math.min(100, total - commits.length)) throw new Error("Incomplete commit page.");
    commits.push(...result.commits);
    if (commits.length === total) {
      const seen = /* @__PURE__ */ new Set();
      for (const commit of commits) {
        if (!sha.test(commit.sha ?? "") || seen.has(commit.sha) || typeof commit.commit?.message !== "string") {
          throw new Error("Invalid or duplicate commit data.");
        }
        seen.add(commit.sha);
      }
      if (total && !seen.has(after)) throw new Error("Comparison did not include the requested head.");
      return commits;
    }
  }
  throw new Error("Incomplete commit range.");
}
function inspectCommits(commits, options) {
  return commits.flatMap((commit) => checkCommitMessage(commit.commit.message, options).map((message) => ({ sha: commit.sha, message })));
}
async function main() {
  const api = new GitHub(input("token"));
  const range = commitRange(event(), process.env.GITHUB_EVENT_NAME, api.repository);
  const commits = await readCommits(api, range, integer(input("max-commits", "250"), 1, 1e3));
  const findings = inspectCommits(commits, {
    maxSubjectLength: integer(input("max-subject-length", "100"), 40, 200),
    maxSummaryLength: integer(input("max-summary-length", "72"), 1, 200),
    allowScopes: boolean(input("allow-scopes", "true"))
  });
  output("valid", findings.length === 0);
  output("checked-count", commits.length);
  output("findings", findings);
  summary("Commit policy", [
    range ? `Inspected ${commits.length} commits in the event's immutable comparison range.` : "Branch deletion: no commit messages to inspect.",
    ...findings.map((finding) => `- ${finding.sha}: ${finding.message}`),
    ...!findings.length ? ["All inspected commit messages satisfy the policy."] : []
  ]);
  console.log(`${commits.length} commits inspected; ${findings.length} findings. See the job summary.`);
  if (findings.length) process.exitCode = 1;
}
runIfMain(import.meta, main);
export {
  commitRange,
  inspectCommits,
  main,
  readCommits
};
