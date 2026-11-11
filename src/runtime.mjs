import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

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
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${JSON.stringify(value)}\n`);
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
  if (process.argv[1] && meta.url === pathToFileURL(process.argv[1]).href) {
    fn().catch(() => {
      // Do not dump API response bodies, tokens, or untrusted event content.
      console.error('Action failed. Check its configuration, token permissions, and GitHub API availability.');
      process.exitCode = 1;
    });
  }
}
