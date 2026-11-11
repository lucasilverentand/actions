import { appendFileSync, readFileSync, realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { EOL } from 'node:os';

export function input(name, fallback = '') {
  return process.env[`INPUT_${name.replaceAll(' ', '_').toUpperCase()}`] ?? fallback;
}

export function boolean(value) {
  if (value !== 'true' && value !== 'false') throw new Error('Expected true or false.');
  return value === 'true';
}

export function integer(value, min, max) {
  if (!/^\d+$/.test(value) || Number(value) < min || Number(value) > max) {
    throw new Error(`Expected an integer between ${min} and ${max}.`);
  }
  return Number(value);
}

export function event() {
  return JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
}

export function output(name, value) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(name)) throw new Error('Invalid output name.');
  if (process.env.GITHUB_OUTPUT) {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    if (text === undefined) throw new Error('Undefined output value.');
    const delimiter = `output_${randomUUID()}`;
    appendFileSync(process.env.GITHUB_OUTPUT, /[\r\n]/.test(text)
      ? `${name}<<${delimiter}${EOL}${text}${EOL}${delimiter}${EOL}` : `${name}=${text}${EOL}`);
  }
}

export function summary(title, lines) {
  if (!process.env.GITHUB_STEP_SUMMARY) return;
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## ${title}\n\n${lines.join('\n')}\n`);
}

export function escapeMarkdown(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('|', '&#124;').replaceAll('\r', ' ').replaceAll('\n', ' ')
    .replaceAll('`', '&#96;').replaceAll('[', '&#91;').replaceAll(']', '&#93;');
}

const genericFailure = 'Action failed. Check its configuration, token permissions, and GitHub API availability.';
// Platform errors can echo inputs, paths, command lines, response text or event content.
const platformErrorKeys = ['code', 'errno', 'syscall', 'path', 'cmd', 'stdout', 'stderr', 'cause', 'errors'];

// Show the library's own fixed diagnostics; keep platform and parser errors generic.
export function failureMessage(error) {
  const own = error instanceof Error &&
    (Object.getPrototypeOf(error) === Error.prototype || error.name === 'ApiError') &&
    !platformErrorKeys.some((key) => Object.hasOwn(error, key));
  const message = own ? String(error.message).replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/gu, ' ').trim().slice(0, 300) : '';
  // One escaped line cannot start another workflow command.
  return `::error::${(message || genericFailure).replaceAll('%', '%25')}`;
}

export function runIfMain(meta, fn) {
  // Node resolves the entry module's symlinks; argv can still contain the symlink path.
  if (process.argv[1] && meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
    fn().catch((error) => {
      console.error(failureMessage(error));
      process.exitCode = 1;
    });
  }
}
