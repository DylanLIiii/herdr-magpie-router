// Arithmetic and stacked-series semantics ported from Magpie Usage's page.js
// and app.js cacheHitOf(). See THIRD_PARTY_NOTICES.md.
const number = value => Number.isFinite(value) && value >= 0 ? value : null;
export function tokenTotal(value, withCache = false) {
  const keys = withCache ? ['input', 'output', 'cache_read', 'cache_write'] : ['input', 'output'];
  return keys.every(key => number(value?.[key]) !== null) ? keys.reduce((n, key) => n + value[key], 0) : null;
}
export function cacheHit(value) {
  if (!['input', 'cache_read', 'cache_write'].every(key => number(value?.[key]) !== null)) return null;
  const prompt = value.input + value.cache_read + value.cache_write - (value.cache_unknown || 0);
  return prompt > 0 ? value.cache_read / prompt : null;
}
export function usageBars(series, withCache, limit = 28) {
  if (!Array.isArray(series)) return [];
  const step = Math.max(1, Math.ceil(series.length / limit));
  const bars = [];
  for (let index = 0; index < series.length; index += step) {
    const points = series.slice(index, index + step);
    const total = points.every(point => tokenTotal(point, withCache) !== null) ? points.reduce((n, point) => n + tokenTotal(point, withCache), 0) : null;
    const output = points.every(point => number(point.output) !== null) ? points.reduce((n, point) => n + point.output, 0) : null;
    bars.push({ label: points.length > 1 ? `${points[0].label} – ${points.at(-1).label}` : points[0].label,
      input: total === null || output === null ? null : Math.max(0, total - output), output, total });
  }
  return bars;
}
