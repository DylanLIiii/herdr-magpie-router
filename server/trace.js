import { createHash } from 'node:crypto';
import { SourceError } from './upstream.js';
import { requestCache } from './request-metrics.js';

const text = value => typeof value === 'string' ? value.slice(0, 180) : '';
const numeric = value => Number.isFinite(value) && value >= 0 ? value : null;
const list = value => Array.isArray(value) ? value.filter(item => item && typeof item === 'object') : [];
const outcome = (done, code, failure) => !done ? 'pending' : failure || Number(code) >= 400 ? 'error' : Number(code) >= 200 && Number(code) < 400 ? 'success' : 'unknown';
const sum = (rows, key) => rows.length && rows.every(row => numeric(row[key]) !== null) ? rows.reduce((n, row) => n + row[key], 0) : null;

/** Projection of Magpie's trace protocol, not its accounts, prompts or raw errors. */
export function projectTrace(data) {
  if (!data || !Number.isSafeInteger(data.seq) || data.seq < 0 || !Array.isArray(data.routes)) throw new SourceError('Magpie trace protocol is unavailable or incompatible');
  const epoch = createHash('sha256').update(JSON.stringify([data.by?.pid || 0, data.by?.serves || 'local'])).digest('hex').slice(0, 16);
  const routes = list(data.routes).slice(-120).map(route => {
    const candidates = [...list(route.order), ...list(route.left)];
    const attempts = list(route.tries).slice(0, 32).map((attempt, index) => {
      const member = candidates.find(candidate => candidate.id === attempt.id);
      const done = attempt.done === true;
      return { index, provider: text(member?.provider || route.provider), model: text(attempt.model || member?.model),
        served: text(attempt.served), start: text(attempt.start), done,
        status: outcome(done, attempt.status, attempt.fail || attempt.error), httpStatus: numeric(attempt.status),
        durationMs: numeric(attempt.ms), ttftMs: numeric(attempt.ttft),
        retryable: Boolean(attempt.rest || attempt.credits || attempt.again && !attempt.gone), gone: attempt.gone === true };
    });
    const last = attempts.at(-1), usage = list(route.usage);
    return { id: String(route.id), seq: numeric(route.seq), timestamp: text(route.time), agent: text(route.agent),
      requestedModel: text(route.model), group: text(route.group?.id), groupRef: text(route.group?.ref),
      groupName: text(route.group?.name), strategy: text(route.group?.routing),
      provider: last?.provider || text(route.provider), model: last?.served || last?.model || text(route.model),
      done: route.done === true, status: route.canceled === true ? 'canceled' : outcome(route.done === true, route.status || last?.httpStatus, route.error),
      durationMs: numeric(route.ms), ttftMs: numeric(route.ttft), inputTokens: sum(usage, 'in'), outputTokens: sum(usage, 'out'),
      ...requestCache(usage), attempts, fallback: attempts.length ? attempts.some((attempt, index) => attempt.status === 'error' && index < attempts.length - 1) : null };
  }).filter(route => route.id !== 'undefined');
  return { seq: data.seq, epoch, mine: data.mine !== false, now: text(data.now), routes,
    ids: Array.isArray(data.ids) ? data.ids.slice(-500).map(String) : null,
    totals: Object.fromEntries(['requests', 'ok', 'failed', 'rerouted'].map(key => [key, numeric(data.totals?.[key])])) };
}

export async function readTrace(read, { web, after = 0, epoch = '', wait = false, signal } = {}) {
  const prefix = web ? '/api/gateway' : '/v1/magpie';
  let frame = projectTrace(await read(`${prefix}/trace?after=${after}${wait ? '&wait=1' : ''}`, { timeout: 30000, signal }));
  const reset = Boolean(epoch && epoch !== frame.epoch || frame.seq < after);
  if (reset && after) frame = projectTrace(await read(`${prefix}/trace?after=0`, { timeout: 30000, signal }));
  return { ...frame, reset };
}
