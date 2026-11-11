// src/runtime.mjs
import { appendFileSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
function input(name, fallback = "") {
  return process.env[`INPUT_${name.replaceAll(" ", "_").toUpperCase()}`] ?? fallback;
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
function runIfMain(meta, fn) {
  if (process.argv[1] && meta.url === pathToFileURL(process.argv[1]).href) {
    fn().catch(() => {
      console.error("Action failed. Check its configuration, token permissions, and GitHub API availability.");
      process.exitCode = 1;
    });
  }
}

// src/pr-policy.mjs
var types = ["feat", "fix", "docs", "style", "refactor", "perf", "test", "build", "ci", "chore", "revert"];
function checkPullRequest(pr, maxTitleLength = 100) {
  const findings = [];
  const title = pr.title ?? "";
  const match = /^(\w+)(?:\([a-zA-Z0-9][a-zA-Z0-9._/-]*\))?(!)?: (\S.*\S|\S)$/.exec(title);
  if (!match || !types.includes(match[1]) || /[\r\n\x00-\x1f\x7f]/.test(title)) {
    findings.push("Use a Conventional Commit title, for example: fix(parser): handle empty input.");
  }
  if ([...title].length > maxTitleLength) findings.push(`Keep the title within ${maxTitleLength} characters.`);
  if (title !== title.trim()) findings.push("Remove whitespace around the title.");
  const body = (pr.body ?? "").replace(/<!--[\s\S]*?(?:-->|$)/g, "");
  const sections = /* @__PURE__ */ new Map();
  let section;
  let fence;
  for (const line of body.split(/\r?\n/)) {
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) {
      if (!fence) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = void 0;
      continue;
    }
    const heading = !fence && /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) {
      section = heading[1].toLowerCase();
      if (!sections.has(section)) sections.set(section, []);
    } else if (section) sections.get(section).push(line);
  }
  for (const name of ["summary", "testing"]) {
    const content = (sections.get(name) ?? []).join("\n").trim();
    const meaningful = content.replace(/^[\s>*_`~\-+\[\]x]+/gm, "").trim();
    if (meaningful.length < 12 || /^(?:todo|tbd|n\/?a|none|not tested|describe (?:your changes|testing))[.!\s]*$/i.test(meaningful)) {
      findings.push(`Add a substantive ${name === "summary" ? "## Summary" : "## Testing"} section. Explain skipped tests when relevant.`);
    }
  }
  return findings;
}
async function main() {
  if (process.env.GITHUB_EVENT_NAME !== "pull_request") {
    throw new Error("Use this action only on pull_request events.");
  }
  const pr = event().pull_request;
  if (!pr) throw new Error("Missing pull request.");
  const findings = checkPullRequest(pr, integer(input("max-title-length", "100"), 40, 200));
  output("valid", findings.length === 0);
  summary("Pull request policy", findings.length ? findings.map((f) => `- ${f}`) : ["Title and body satisfy the policy."]);
  for (const finding of findings) console.error(finding);
  if (findings.length) process.exitCode = 1;
}
runIfMain(import.meta, main);
export {
  checkPullRequest,
  main,
  types
};
