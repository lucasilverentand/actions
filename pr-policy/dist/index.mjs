import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);

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

// pr-policy/src/index.mjs
function visibleBody(body) {
  const lines = [];
  let fence;
  for (const line of body.replace(/<!--[\s\S]*?(?:-->|$)/g, "").split(/\r?\n/)) {
    const marker = /^\s{0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (marker) {
      if (!fence) fence = marker[1];
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) fence = void 0;
      continue;
    }
    if (!fence && !/^\s{0,3}\[[^\]]+\]:/.test(line)) lines.push(line);
  }
  return lines.join("\n");
}
function parseIssuePrefixes(value) {
  const prefixes = JSON.parse(value);
  if (!Array.isArray(prefixes) || prefixes.length > 50 || prefixes.some((prefix) => !/^[A-Z][A-Z0-9]{0,19}$/.test(prefix))) {
    throw new Error("issue-prefixes must be a JSON array of uppercase issue keys.");
  }
  return prefixes;
}
function hasIssueReference(body, prefixes = []) {
  const text = visibleBody(body).replace(/(?<!`)(`+)(?!`)[\s\S]*?(?<!`)\1(?!`)/g, "");
  const allowed = new Set(prefixes);
  return [...text.matchAll(/\b([A-Z][A-Z0-9]{0,19})-([1-9][0-9]*)\b/g)].some((match) => !allowed.size || allowed.has(match[1]));
}
function checkPullRequest(pr, maxTitleLength = 100, options = {}) {
  const findings = checkSubject(pr.title ?? "", { maxSubjectLength: maxTitleLength, ...options });
  const body = typeof pr.body === "string" ? pr.body : "";
  const sections = /* @__PURE__ */ new Map();
  let section;
  let level;
  for (const line of visibleBody(body).split("\n")) {
    const heading = /^\s{0,3}(#{1,6})\s+(.+?)(?:\s+#+)?\s*$/.exec(line);
    if (heading) {
      const name = heading[2].toLowerCase();
      if (["summary", "testing"].includes(name)) {
        section = name;
        level = heading[1].length;
        if (!sections.has(section)) sections.set(section, []);
      } else if (section && heading[1].length <= level) section = void 0;
    } else if (section) sections.get(section).push(line);
  }
  for (const name of ["summary", "testing"]) {
    const content = (sections.get(name) ?? []).join("\n").trim();
    const meaningful = content.replace(/^\s*(?:[-*+]\s+)?(?:\[[ xX]\]\s*)?/gm, "").replace(/<[^>]*>/g, "").replace(/[*_`~]/g, "").trim();
    const letters = meaningful.match(/[\p{L}\p{N}]/gu) ?? [];
    if (letters.length < 12 || /^(?:(?:todo|tbd|n\/?a|none|not tested|describe (?:your changes|testing))[.!\s*_`~-]*)+$/i.test(meaningful)) {
      findings.push(`Add a substantive ${name === "summary" ? "## Summary" : "## Testing"} section. Explain skipped tests when relevant.`);
    }
  }
  if (options.requireIssueReference && !hasIssueReference(body, options.issuePrefixes)) {
    findings.push("Link a tracked work item in the PR body using its issue key, for example: ENG-123.");
  }
  return findings;
}
async function main() {
  if (process.env.GITHUB_EVENT_NAME !== "pull_request") {
    throw new Error("Use this action only on pull_request events.");
  }
  const pr = event().pull_request;
  if (!pr) throw new Error("Missing pull request.");
  const findings = checkPullRequest(pr, integer(input("max-title-length", "100"), 40, 200), {
    maxSummaryLength: integer(input("max-summary-length", "72"), 1, 200),
    allowScopes: boolean(input("allow-scopes", "true")),
    requireIssueReference: boolean(input("require-issue-reference", "false")),
    issuePrefixes: parseIssuePrefixes(input("issue-prefixes", "[]"))
  });
  output("valid", findings.length === 0);
  summary("Pull request policy", findings.length ? findings.map((f) => `- ${f}`) : ["Title and body satisfy the policy."]);
  for (const finding of findings) console.error(finding);
  if (findings.length) process.exitCode = 1;
}
runIfMain(import.meta, main);
export {
  checkPullRequest,
  hasIssueReference,
  main,
  parseIssuePrefixes,
  types,
  visibleBody
};
