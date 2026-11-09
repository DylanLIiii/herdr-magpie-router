const routes = [
  { id: 'coding', name: 'coding', strategy: 'priority', enabled: true, candidates: [{ provider: 'openai', model: 'gpt-5.4' }, { provider: 'anthropic', model: 'claude-sonnet-4-6' }] },
  { id: 'reasoning', name: 'reasoning', strategy: 'priority', enabled: true, candidates: [{ provider: 'anthropic', model: 'claude-opus-4-6' }, { provider: 'openai', model: 'gpt-5.4' }] },
  { id: 'fast', name: 'fast', strategy: 'weighted', enabled: true, candidates: [{ provider: 'google', model: 'gemini-2.5-flash', weight: 3 }, { provider: 'openai', model: 'gpt-4.1-mini', weight: 1 }] },
];

export function demoDashboard(period = 'today') {
  const snapshot = demoSnapshot();
  const models = new Map();
  for (const request of snapshot.requests) {
    const key = `${request.provider}/${request.model}`;
    if (!models.has(key)) models.set(key, { model: request.model, provider: request.provider, calls: 0, errors: 0, input: 0, output: 0, cache_read: 0, cache_write: 0, cost: null, unpriced: 0 });
    const row = models.get(key);
    row.calls++;
    row.errors += request.status === 'error' ? 1 : 0;
    row.input += request.inputTokens || 0;
    row.output += request.outputTokens || 0;
    row.unpriced++;
  }
  const rows = [...models.values()].sort((a, b) => b.calls - a.calls);
  const total = key => rows.reduce((sum, row) => sum + row[key], 0);
  return {
    ...snapshot, period, zone: 'Demo time zone',
    service: { url: 'Synthetic preview · no service connected', kind: 'demo' }, warnings: [],
    configuredGroups: snapshot.groups.map(group => ({ ...group, ref: `auto/${group.id}`, ready: true,
      members: group.candidates.map(member => ({ ...member, id: `${member.provider}/${member.model}`, weight: member.weight || 1, group: false, ready: true, enabled: true })) })),
    usage: { period, calls: total('calls'), errors: total('errors'), input: total('input'), output: total('output'),
      cache_read: 0, cache_write: 0, cost: null, unpriced: total('unpriced'), models: rows },
  };
}

/** All values in this module are synthetic. They never represent a running Magpie instance. */
export function demoSnapshot(now = Date.now()) {
  const requests = Array.from({ length: 64 }, (_, i) => {
    const group = routes[i % routes.length];
    const fallback = i % 13 === 3;
    const failed = i % 23 === 7;
    // Synthetic weighted traffic follows a smooth 3:1 split, so the native
    // replay can demonstrate different observed destinations without inventing live activity.
    const weightedChoice = group.strategy === 'weighted' && Math.floor(i / routes.length) % 4 === 2 ? 1 : 0;
    const candidate = group.candidates[fallback ? 1 : weightedChoice];
    const durationMs = 780 + ((i * 677) % 6100);
    const attempts = [];
    if (fallback) attempts.push({ ...group.candidates[0], status: 'error', durationMs: 432, error: 'HTTP 429 · upstream rate limit (synthetic)' });
    attempts.push({ provider: candidate.provider, model: candidate.model, status: failed ? 'error' : 'success', durationMs: durationMs - (fallback ? 432 : 0), ...(failed ? { error: 'HTTP 503 · upstream unavailable (synthetic)' } : {}) });
    return {
      id: `demo-${String(1064 - i).padStart(6, '0')}`,
      timestamp: new Date(now - i * 12000 - 2300).toISOString(),
      group: group.id,
      requestedModel: `auto/${group.id}`,
      provider: candidate.provider,
      model: candidate.model,
      status: failed ? 'error' : 'success',
      durationMs,
      ttftMs: failed ? null : 180 + ((i * 113) % 700),
      inputTokens: failed ? null : 1000 + ((i * 331) % 12000),
      outputTokens: failed ? null : 160 + ((i * 73) % 2200),
      fallback,
      attempts,
      ...(failed ? { error: 'HTTP 503 · upstream unavailable (synthetic)' } : {}),
    };
  });
  return {
    mode: 'demo',
    connection: 'connected',
    updatedAt: new Date(now).toISOString(),
    source: { label: '演示数据', detail: '示例路由，仅用于预览 · 所有数值均为合成数据' },
    groups: structuredClone(routes),
    providers: ['openai', 'anthropic', 'google'].map(id => {
      const attempts = requests.flatMap(request => request.attempts).filter(attempt => attempt.provider === id);
      const errors = attempts.filter(attempt => attempt.status === 'error').length;
      return { id, name: { openai: 'OpenAI', anthropic: 'Anthropic', google: 'Google' }[id], requests: attempts.length, errors, status: errors ? 'degraded' : 'healthy' };
    }),
    requests,
  };
}
