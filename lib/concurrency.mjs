// Bound independent reads while preserving order and waiting for already-started work on failure.
export async function mapConcurrent(items, concurrency, mapper) {
  if (!Array.isArray(items) || !Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16 || typeof mapper !== 'function') {
    throw new Error('Invalid concurrent inspection configuration.');
  }
  const results = new Array(items.length);
  let next = 0;
  let failed = false;
  async function worker() {
    while (!failed && next < items.length) {
      const index = next++;
      try { results[index] = await mapper(items[index], index); }
      catch { failed = true; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  if (failed) throw new Error('Concurrent inspection failed. Verify access and API availability.');
  return results;
}
