export function jobNames(value, label) {
  if (!Array.isArray(value) || value.some((name) => typeof name !== 'string' || !/^[A-Za-z_][A-Za-z0-9_-]*$/.test(name)) || new Set(value).size !== value.length) {
    throw new Error(`${label} must be a JSON array of unique job IDs.`);
  }
  return value;
}

export function evaluateJobs(needs, { required = [], allowSkipped = [] } = {}) {
  jobNames(required, 'required-jobs');
  jobNames(allowSkipped, 'allow-skipped');
  if (!needs || typeof needs !== 'object' || Array.isArray(needs)) throw new Error('Expected the toJSON(needs) object.');
  const names = Object.keys(needs);
  jobNames(names, 'needs keys');
  const failures = [];
  if (!names.length) failures.push({ job: '(workflow)', result: 'missing', message: 'No upstream jobs were supplied.' });
  const selected = new Set([...names, ...required]);
  for (const name of allowSkipped) {
    if (!selected.has(name)) throw new Error('allow-skipped names a job outside the dependency set.');
  }
  const results = {};
  for (const name of selected) {
    const job = Object.hasOwn(needs, name) ? needs[name] : undefined;
    const result = job && typeof job === 'object' && !Array.isArray(job) ? job.result : undefined;
    const known = ['success', 'failure', 'cancelled', 'skipped'].includes(result);
    Object.defineProperty(results, name, { value: known ? result : 'missing', enumerable: true });
    if (result !== 'success' && !(result === 'skipped' && allowSkipped.includes(name))) {
      failures.push({ job: name, result: known ? result : 'missing', message: 'Required upstream job did not succeed.' });
    }
  }
  return { passed: failures.length === 0, results, failures };
}
