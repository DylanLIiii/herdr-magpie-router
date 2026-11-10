import { requestCache } from './request-metrics.js';

const list = value => Array.isArray(value) ? value : [];
const text = value => typeof value === 'string' ? value.slice(0, 300) : value == null ? '' : String(value).slice(0, 300);
const numeric = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const positive = value => numeric(value) > 0 ? value : null;
const identity = row => text(row?.id ?? row?.route_id);
const sumCounters = (rows, key) => rows.length && rows.every(row => numeric(row[key]) !== null)
  ? rows.reduce((total, row) => total + row[key], 0) : null;

function ledgerOf(rows) {
  // The API is newest-first. Stable sorting preserves that order for equal timestamps.
  // handed_on rows are billed attempts, never the final result of their route.
  const ordered = rows.slice().sort((a, b) => (Date.parse(timestamp(b.t)) || 0) - (Date.parse(timestamp(a.t)) || 0));
  const final = ordered.find(row => row.handed_on !== true);
  return { final, latest: final || ordered[0], input: sumCounters(rows, 'in'), output: sumCounters(rows, 'out'), rows };
}

function timestamp(value) {
  // Go time.Time is RFC3339; the usage ledger's t can also be a unix second count.
  const parsed = typeof value === 'number' ? new Date(value < 1e12 ? value * 1000 : value) : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}
function status(code, done, failure) {
  if (failure || Number(code) >= 400) return 'error';
  if (done === false) return 'pending';
  if (Number(code) >= 200 && Number(code) < 400) return 'success';
  return 'pending';
}
function safeError(value, code) {
  // Upstream error strings can echo credentials or prompts. Forward a bounded category only.
  if (Number(code) >= 400) return `HTTP ${Number(code)}`;
  if (value) return '上游请求失败，详细原因请在 Magpie 中查看';
  return undefined;
}

export function normalizeSnapshot({ routes = [], rows = [], sourceKind, warning, now = Date.now() }) {
  const usageById = new Map();
  const directOccurrences = new Map();
  for (const row of list(rows)) {
    if (!row || typeof row !== 'object') continue;
    let id = identity(row);
    // Older/direct ledger entries have no route identity and must not collapse into id "0".
    if (!id || id === '0') {
      const base = `usage:${text(row.t)}:${text(row.provider)}:${text(row.model)}`;
      const occurrence = directOccurrences.get(base) || 0;
      directOccurrences.set(base, occurrence + 1);
      id = `${base}:${occurrence}`;
    }
    if (!usageById.has(id)) usageById.set(id, []);
    usageById.get(id).push(row);
  }
  const records = new Map();
  for (const route of list(routes)) if (route && typeof route === 'object' && identity(route)) records.set(identity(route), route);
  const groups = new Map();
  const providerNames = new Map();
  const requests = [];
  const providerObservations = new Map();
  for (const [id, route] of records) {
    const ledger = ledgerOf(usageById.get(id) || []);
    const usage = ledger.latest;
    usageById.delete(id);
    const time = timestamp(route.time) || timestamp(usage?.t);
    if (!time || Date.parse(time) < now - 86400000) continue;
    const candidates = [...list(route.order), ...list(route.left)].filter(row => row && typeof row === 'object');
    for (const candidate of candidates) if (candidate.provider && candidate.name) providerNames.set(text(candidate.provider), text(candidate.name));
    const attempts = list(route.tries).filter(row => row && typeof row === 'object').map(attempt => {
      const candidate = candidates.find(candidate => String(candidate.id) === String(attempt.id));
      const code = attempt.status;
      const failure = attempt.fail || attempt.error;
      return {
        provider: text(candidate?.provider || route.provider || usage?.provider),
        model: text(attempt.served || attempt.model),
        status: status(code, attempt.done, failure),
        durationMs: positive(attempt.ms),
        ...(safeError(failure, code) ? { error: safeError(failure, code) } : {}),
      };
    });
    const last = attempts.at(-1);
    const requestedModel = text(route.model || usage?.req || usage?.model);
    const groupId = text(route.group?.id || (/^(?:group|auto)\//.test(requestedModel) ? requestedModel : ''));
    if (groupId) {
      const previous = groups.get(groupId);
      if (!previous || Date.parse(time) > previous.observedAt) groups.set(groupId, {
        id: groupId, name: text(route.group?.name || route.group?.ref || groupId),
        strategy: text(route.group?.routing || '未提供'), enabled: true, observedAt: Date.parse(time),
        candidates: [...new Map(candidates.map(candidate => [`${candidate.provider}/${candidate.model}`, { provider: text(candidate.provider), model: text(candidate.model) }])).values()],
      });
    }
    const billable = list(route.usage).filter(row => row && typeof row === 'object');
    const code = route.status || ledger.final?.status;
    const failure = route.error;
    requests.push({
      id, timestamp: time, group: groupId, groupName: text(route.group?.name), strategy: text(route.group?.routing),
      agent: text(route.agent || usage?.agent), requestedModel,
      provider: last?.provider || text(usage?.provider || route.provider),
      model: text(route.served || usage?.served || last?.model || usage?.model || requestedModel),
      status: route.canceled === true ? 'canceled' : status(code, route.done, failure),
      durationMs: positive(usage?.ms) ?? positive(route.ms),
      ttftMs: positive(usage?.ttft_ms) ?? positive(route.ttft),
      inputTokens: sumCounters(billable, 'in') ?? ledger.input,
      outputTokens: sumCounters(billable, 'out') ?? ledger.output ?? positive(route.out),
      ...requestCache(billable.length ? billable : ledger.rows),
      fallback: attempts.length ? attempts.some((attempt, index) => attempt.status === 'error' && index < attempts.length - 1) : null,
      attempts,
      ...(safeError(failure, code) ? { error: safeError(failure, code) } : {}),
    });
    if (!attempts.length && ledger.rows.length) providerObservations.set(id, ledger.rows);
  }
  for (const [id, entries] of usageById) {
    const ledger = ledgerOf(entries);
    const row = ledger.latest;
    const time = timestamp(row.t);
    if (!time || Date.parse(time) < now - 86400000) continue;
    const code = ledger.final?.status;
    const requestedModel = text(row.req || row.model);
    requests.push({
      id, timestamp: time, group: /^(?:group|auto)\//.test(requestedModel) ? requestedModel : '', requestedModel, agent: text(row.agent),
      provider: text(row.provider), model: text(row.served || row.model), status: status(code, Boolean(ledger.final)),
      durationMs: positive(row.ms), ttftMs: positive(row.ttft_ms),
      inputTokens: ledger.input, outputTokens: ledger.output, ...requestCache(ledger.rows),
      fallback: null, attempts: [],
      ...(safeError(null, code) ? { error: safeError(null, code) } : {}),
    });
    providerObservations.set(id, entries);
    for (const entry of entries) if (entry.providerName) providerNames.set(text(entry.provider), text(entry.providerName));
  }
  requests.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
  requests.splice(500);
  const providers = new Map();
  for (const request of requests) {
    const observations = request.attempts.length ? request.attempts : providerObservations.has(request.id)
      ? providerObservations.get(request.id).map(row => ({ provider: text(row.provider), status: status(row.status, true) }))
      : [{ provider: request.provider, status: request.status }];
    for (const attempt of observations) {
      if (!attempt.provider) continue;
      if (!providers.has(attempt.provider)) providers.set(attempt.provider, { id: attempt.provider, name: providerNames.get(attempt.provider) || attempt.provider, status: 'unknown', requests: 0, errors: 0 });
      const provider = providers.get(attempt.provider);
      provider.requests++;
      if (attempt.status === 'error') provider.errors++;
      if (provider.errors) provider.status = 'degraded';
      else if (attempt.status === 'success') provider.status = 'healthy';
    }
  }
  const detail = {
    trace: 'Magpie 实时 trace · 最近 24 小时可见记录，最多 500 条',
    history: 'Magpie 本机路由历史 · 最多 500 条，记录写入可能有延迟',
    usage: 'Magpie usage · 缺少尝试历史，无法确认回退过程',
  }[sourceKind];
  return {
    mode: 'live', connection: 'connected', updatedAt: new Date(now).toISOString(),
    source: { label: 'Magpie', detail: detail + (warning ? ` · ${warning}` : '') },
    requests, groups: [...groups.values()].map(({ observedAt, ...group }) => group), providers: [...providers.values()],
  };
}
