import { appendFileSync, readFileSync, realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';

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
      ? `${name}<<${delimiter}\n${text}\n${delimiter}\n` : `${name}=${text}\n`);
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

export function runIfMain(meta, fn) {
  // Node resolves the entry module's symlinks; argv can still contain the symlink path.
  if (process.argv[1] && meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
    fn().catch(() => {
      // Do not dump API response bodies, tokens, or untrusted event content.
      console.error('Action failed. Check its configuration, token permissions, and GitHub API availability.');
      process.exitCode = 1;
    });
  }
}
