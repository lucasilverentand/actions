export const types = ['feat', 'fix', 'docs', 'style', 'refactor', 'perf', 'test', 'build', 'ci', 'chore', 'revert'];

export function checkSubject(subject, { maxSubjectLength = 100, maxSummaryLength = 100, allowScopes = true } = {}) {
  if (typeof subject !== 'string') return ['Provide a Conventional Commit subject.'];
  const findings = [];
  const match = /^([a-z]+)(?:\(([a-zA-Z0-9][a-zA-Z0-9._/-]*)\))?(!)?: (\S(?:.*\S)?)$/u.exec(subject);
  // Reject line separators, controls, and directional overrides in displayed subjects.
  if (!match || !types.includes(match[1]) || /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/u.test(subject)) {
    findings.push('Use a Conventional Commit subject, for example: fix: handle empty input.');
  }
  if ([...subject].length > maxSubjectLength) findings.push(`Keep the subject within ${maxSubjectLength} characters.`);
  if (subject !== subject.trim()) findings.push('Remove whitespace around the subject.');
  if (match && [...match[4]].length > maxSummaryLength) findings.push(`Keep the summary after the type within ${maxSummaryLength} characters.`);
  if (match?.[2] && !allowScopes) findings.push('Scopes are disabled by this repository policy.');
  return findings;
}
