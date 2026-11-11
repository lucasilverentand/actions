import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);

// lib/job-results.mjs
function jobNames(value, label) {
  if (!Array.isArray(value) || value.some((name) => typeof name !== "string" || !/^[A-Za-z_][A-Za-z0-9_-]*$/.test(name)) || new Set(value).size !== value.length) {
    throw new Error(`${label} must be a JSON array of unique job IDs.`);
  }
  return value;
}
function evaluateJobs(needs, { required = [], allowSkipped = [] } = {}) {
  jobNames(required, "required-jobs");
  jobNames(allowSkipped, "allow-skipped");
  if (!needs || typeof needs !== "object" || Array.isArray(needs)) throw new Error("Expected the toJSON(needs) object.");
  const names = Object.keys(needs);
  jobNames(names, "needs keys");
  const failures = [];
  if (!names.length) failures.push({ job: "(workflow)", result: "missing", message: "No upstream jobs were supplied." });
  const selected = /* @__PURE__ */ new Set([...names, ...required]);
  for (const name of allowSkipped) {
    if (!selected.has(name)) throw new Error("allow-skipped names a job outside the dependency set.");
  }
  const results = {};
  for (const name of selected) {
    const job = Object.hasOwn(needs, name) ? needs[name] : void 0;
    const result = job && typeof job === "object" && !Array.isArray(job) ? job.result : void 0;
    const known = ["success", "failure", "cancelled", "skipped"].includes(result);
    Object.defineProperty(results, name, { value: known ? result : "missing", enumerable: true });
    if (result !== "success" && !(result === "skipped" && allowSkipped.includes(name))) {
      failures.push({ job: name, result: known ? result : "missing", message: "Required upstream job did not succeed." });
    }
  }
  return { passed: failures.length === 0, results, failures };
}

// lib/runtime.mjs
import { appendFileSync, readFileSync, realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
function input(name, fallback = "") {
  return process.env[`INPUT_${name.replaceAll(" ", "_").toUpperCase()}`] ?? fallback;
}
function boolean(value) {
  if (value !== "true" && value !== "false") throw new Error("Expected true or false.");
  return value === "true";
}
function output(name, value) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(name)) throw new Error("Invalid output name.");
  if (process.env.GITHUB_OUTPUT) {
    const text = typeof value === "string" ? value : JSON.stringify(value);
    if (text === void 0) throw new Error("Undefined output value.");
    const delimiter = `output_${randomUUID()}`;
    appendFileSync(process.env.GITHUB_OUTPUT, /[\r\n]/.test(text) ? `${name}<<${delimiter}
${text}
${delimiter}
` : `${name}=${text}
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
  if (process.argv[1] && meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
    fn().catch(() => {
      console.error("Action failed. Check its configuration, token permissions, and GitHub API availability.");
      process.exitCode = 1;
    });
  }
}

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

// scripts/release/metadata.mjs
function parseVersion(version) {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(version ?? "");
  if (!match || match.slice(1).some((part) => !Number.isSafeInteger(Number(part)))) {
    throw new Error("Use a stable semantic version such as 1.2.3.");
  }
  return match.slice(1).map(Number);
}
function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  for (let index = 0; index < 3; index++) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  }
  return 0;
}
function bumpVersion(version, level) {
  const index = ["major", "minor", "patch"].indexOf(level);
  if (index === -1) throw new Error("Choose major, minor, or patch.");
  const parts = parseVersion(version);
  parts[index]++;
  parts.fill(0, index + 1);
  const next = parts.join(".");
  parseVersion(next);
  return next;
}
function analyzeCommits(commits) {
  if (!commits.length) return null;
  let level = "patch";
  for (const commit of commits) {
    const message = commit.commit?.message;
    const header = /^([a-z]+)(?:\([^\r\n)]+\))?(!)?: ([^\r\n]+)/.exec(message ?? "");
    if (!header || checkSubject(message.split(/\r?\n/)[0], { maxSubjectLength: Number.MAX_SAFE_INTEGER, maxSummaryLength: Number.MAX_SAFE_INTEGER }).length) {
      throw new Error("A merged commit is not a supported Conventional Commit; review its title before releasing.");
    }
    if (header[2] || /^BREAKING[ -]CHANGE:\s*\S/m.test(message)) level = "major";
    else if (header[1] === "feat" && level !== "major") level = "minor";
  }
  return level;
}

// scripts/release/plan.mjs
async function stableReleases(api) {
  const result = [];
  for (let page = 1; page <= 100; page++) {
    const batch = await api.request("GET", `/releases?per_page=100&page=${page}`);
    if (!Array.isArray(batch)) throw new Error("Invalid release inventory.");
    for (const release of batch) {
      if (release.draft || release.prerelease || !/^v\d+\.\d+\.\d+$/.test(release.tag_name)) continue;
      parseVersion(release.tag_name.slice(1));
      result.push(release);
    }
    if (batch.length < 100) return result;
  }
  throw new Error("Incomplete release inventory.");
}
async function planRelease(api, sha, { initialVersion = "1.0.0" } = {}) {
  if (!/^[a-f0-9]{40}$/.test(sha ?? "")) throw new Error("Expected an exact release commit.");
  parseVersion(initialVersion);
  const releases = await stableReleases(api);
  const latest = releases.sort((a, b) => compareVersions(b.tag_name.slice(1), a.tag_name.slice(1)))[0];
  const baseSha = latest ? (await api.request("GET", `/commits/${encodeURIComponent(latest.tag_name)}`)).sha : null;
  if (latest && !/^[a-f0-9]{40}$/.test(baseSha ?? "")) throw new Error("Cannot resolve the previous release commit.");
  const commits = [];
  let complete = false;
  let total;
  for (let page = 1; page <= 100; page++) {
    let batch;
    if (latest) {
      const comparison = await api.request("GET", `/compare/${baseSha}...${sha}?per_page=100&page=${page}`);
      if (!["ahead", "identical"].includes(comparison.status) || !Number.isSafeInteger(comparison.total_commits) || comparison.total_commits < 0) {
        throw new Error("Release history is divergent or incomplete.");
      }
      if (page > 1 && total !== comparison.total_commits) throw new Error("Release comparison changed during pagination.");
      total = comparison.total_commits;
      batch = comparison.commits;
    } else {
      batch = await api.request("GET", `/commits?sha=${sha}&per_page=100&page=${page}`);
    }
    if (!Array.isArray(batch)) throw new Error("Invalid commit inventory.");
    commits.push(...batch);
    if (batch.length < 100) {
      complete = true;
      break;
    }
  }
  if (!complete || latest && commits.length !== total) throw new Error("Incomplete commit inventory.");
  if (new Set(commits.map((commit) => commit.sha)).size !== commits.length || commits.some((commit) => !/^[a-f0-9]{40}$/.test(commit.sha ?? ""))) throw new Error("Invalid or duplicate commits.");
  const level = analyzeCommits(commits);
  if (!level) return null;
  const version = latest ? bumpVersion(latest.tag_name.slice(1), level) : initialVersion;
  const notes = "## Changes\n\n" + commits.map((commit) => `- ${escapeMarkdown(commit.commit.message.split(/\r?\n/)[0])} (${commit.sha.slice(0, 7)})`).join("\n");
  return { version, tag: `v${version}`, notes };
}

// scripts/release/publisher.mjs
var ReleaseApi = class {
  constructor(token, repository) {
    if (!token || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? "")) throw new Error("Missing release credentials or repository.");
    if (process.env.GITHUB_API_URL && process.env.GITHUB_API_URL !== "https://api.github.com") throw new Error("Only GitHub.com is supported.");
    this.token = token;
    this.repository = repository;
  }
  async request(method, path, body) {
    if (!["GET", "POST"].includes(method) || path !== "" && !path.startsWith("/")) throw new Error("Invalid release request.");
    const response = await fetch(`https://api.github.com/repos/${this.repository}${path}`, {
      method,
      redirect: "error",
      signal: AbortSignal.timeout(3e4),
      headers: {
        authorization: `Bearer ${this.token}`,
        accept: "application/vnd.github+json",
        "content-type": "application/json",
        "x-github-api-version": "2022-11-28"
      },
      ...body ? { body: JSON.stringify(body) } : {}
    });
    if (!response.ok) throw Object.assign(new Error(`Release API returned ${response.status}.`), { status: response.status });
    return response.json();
  }
};
async function optional(api, path) {
  try {
    return await api.request("GET", path);
  } catch (error) {
    if (error.status === 404) return null;
    throw error;
  }
}
async function publishRelease(api, metadata, context) {
  const { version, tag, notes } = metadata;
  parseVersion(version);
  if (tag !== `v${version}` || notes.trim().length < 20) throw new Error("Invalid release metadata.");
  if (!["push", "workflow_dispatch"].includes(context.event) || !/^[a-f0-9]{40}$/.test(context.sha ?? "")) {
    throw new Error("Releases require a verified push or manual run.");
  }
  const repo = await api.request("GET", "");
  if (repo.archived || repo.disabled || repo.fork) throw new Error("Repository is not eligible for releases.");
  if (context.ref !== `refs/heads/${repo.default_branch}`) throw new Error("Release only from the default branch.");
  const branchPath = `/git/ref/heads/${encodeURIComponent(repo.default_branch)}`;
  const head = await api.request("GET", branchPath);
  if (head.object.sha !== context.sha) throw new Error("Default branch advanced; release from a fresh verified run.");
  for (const release2 of await stableReleases(api)) {
    if (compareVersions(version, release2.tag_name.slice(1)) < 0) throw new Error("Version is older than a published stable release.");
  }
  const existing = await optional(api, `/releases/tags/${tag}`);
  if (existing) {
    if (existing.draft || existing.prerelease) throw new Error("An unfinished release already uses this version.");
  }
  let ref = await optional(api, `/git/ref/tags/${tag}`);
  if (ref) {
    let object = ref.object;
    for (let depth = 0; object.type === "tag" && depth < 10; depth++) {
      object = (await api.request("GET", `/git/tags/${object.sha}`)).object;
    }
    if (object.type !== "commit" || object.sha !== context.sha) throw new Error("Existing tag points to another commit; never move a version tag.");
  }
  if (existing) {
    if (!ref) throw new Error("Published release is missing its immutable tag.");
    return { created: false, tag, url: existing.html_url };
  }
  if ((await api.request("GET", branchPath)).object.sha !== context.sha) throw new Error("Default branch advanced during release preparation.");
  if (!ref) await api.request("POST", "/git/refs", { ref: `refs/tags/${tag}`, sha: context.sha });
  const release = await api.request("POST", "/releases", {
    tag_name: tag,
    target_commitish: context.sha,
    name: tag,
    body: notes,
    draft: false,
    prerelease: false,
    generate_release_notes: false,
    make_latest: "true"
  });
  return { created: true, tag, url: release.html_url };
}

// release/src/index.mjs
async function runRelease(api, context, { dryRun = true, needs = {}, initialVersion = "1.0.0" } = {}) {
  if (!["push", "workflow_dispatch"].includes(context.event) || !/^[a-f0-9]{40}$/.test(context.sha ?? "")) {
    throw new Error("Use a default-branch push or manual run at an exact commit.");
  }
  const repo = await api.request("GET", "");
  if (repo.archived || repo.disabled || repo.fork || context.ref !== `refs/heads/${repo.default_branch}`) {
    throw new Error("Release requires an active original repository and its default branch.");
  }
  const head = await api.request("GET", `/git/ref/heads/${encodeURIComponent(repo.default_branch)}`);
  if (head.object.sha !== context.sha) throw new Error("Default branch advanced; use a fresh run.");
  if (!dryRun && !evaluateJobs(needs).passed) throw new Error("Publication requires successful upstream verification jobs.");
  const plan = await planRelease(api, context.sha, { initialVersion });
  if (!plan) return { planned: false, created: false, version: "", tag: "", url: "", notes: "" };
  if (dryRun) return { ...plan, planned: true, created: false, url: "" };
  return { ...plan, ...await publishRelease(api, plan, context), planned: true };
}
async function main() {
  const result = await runRelease(new ReleaseApi(input("token"), process.env.GITHUB_REPOSITORY), {
    event: process.env.GITHUB_EVENT_NAME,
    ref: process.env.GITHUB_REF,
    sha: process.env.GITHUB_SHA
  }, {
    dryRun: boolean(input("dry-run", "true")),
    needs: JSON.parse(input("needs", "{}")),
    initialVersion: input("initial-version", "1.0.0")
  });
  for (const [key, value] of Object.entries(result)) output(key, value);
  summary("Semantic release", [result.planned ? `${result.tag}: ${result.created ? "published" : "preview or already published; no mutation"}.` : "No unreleased commits."]);
}
runIfMain(import.meta, main);
export {
  main,
  runRelease
};
