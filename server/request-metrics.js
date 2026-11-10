const finite = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;

/** Same cache denominator as Magpie: uncached input + cache read + cache write.
 * Its trace omits zero cache counters; vendors marked unknown stay unknown. */
export function requestCache(rows) {
  const known = rows.filter(row => finite(row.in) && row.cache_unknown !== true
    && (row.cache_read == null || finite(row.cache_read)) && (row.cache_write == null || finite(row.cache_write)));
  if (!known.length) return { cacheReadTokens: null, cacheWriteTokens: null, cacheHit: null };
  const read = known.reduce((sum, row) => sum + (row.cache_read || 0), 0);
  const write = known.reduce((sum, row) => sum + (row.cache_write || 0), 0);
  const prompt = known.reduce((sum, row) => sum + row.in, 0) + read + write;
  return { cacheReadTokens: read, cacheWriteTokens: write, cacheHit: prompt > 0 ? read / prompt : null };
}
