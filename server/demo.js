const routes = [
  { id: 'coding', name: 'coding', strategy: 'priority', enabled: true, candidates: [{ provider: 'openai', model: 'gpt-5.4' }, { provider: 'anthropic', model: 'claude-sonnet-4-6' }] },
  { id: 'reasoning', name: 'reasoning', strategy: 'priority', enabled: true, candidates: [{ provider: 'anthropic', model: 'claude-opus-4-6' }, { provider: 'openai', model: 'gpt-5.4' }] },
  { id: 'fast', name: 'fast', strategy: 'weighted', enabled: true, candidates: [{ provider: 'google', model: 'gemini-2.5-flash', weight: 3 }, { provider: 'openai', model: 'gpt-4.1-mini', weight: 1 }] },
];

/** All values in this module are synthetic. They never represent a running Magpie instance. */
export function demoSnapshot(now = Date.now()) {
  const requests = Array.from({ length: 64 }, (_, i) => {
    const group = routes[i % routes.length];
    const fallback = i % 13 === 3;
    const failed = i % 23 === 7;
    const candidate = group.candidates[fallback ? 1 : 0];
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
