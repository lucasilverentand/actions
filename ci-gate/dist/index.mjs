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
import { EOL } from "node:os";
function input(name, fallback = "") {
  return process.env[`INPUT_${name.replaceAll(" ", "_").toUpperCase()}`] ?? fallback;
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

// ci-gate/src/index.mjs
async function main() {
  const result = evaluateJobs(JSON.parse(input("needs")), {
    required: JSON.parse(input("required-jobs", "[]")),
    allowSkipped: JSON.parse(input("allow-skipped", "[]"))
  });
  output("passed", result.passed);
  output("failures", result.failures);
  summary("Required jobs", result.passed ? ["All required upstream jobs satisfy the gate."] : result.failures.map((f) => `- ${escapeMarkdown(f.job)}: ${f.result}.`));
  if (!result.passed) process.exitCode = 1;
}
runIfMain(import.meta, main);
export {
  evaluateJobs,
  main
};
