import { projectTrace } from './trace.js';

/** Synthetic protocol fixture: selecting → pending → retry → pending → success. */
export function demoTrace(now = Date.now()) {
  const cycle = 12000, current = Math.floor(now / cycle);
  const routes = [current - 1, current].map((id, i) => {
    const start = id * cycle, elapsed = now - start, done = elapsed >= 9500;
    const group = ['coding', 'reasoning', 'fast'][id % 3];
    const models = group === 'fast' ? [['google', 'gemini-2.5-flash'], ['openai', 'gpt-4.1-mini']]
      : group === 'reasoning' ? [['anthropic', 'claude-opus-4-6'], ['openai', 'gpt-5.4']]
      : [['openai', 'gpt-5.4'], ['anthropic', 'claude-sonnet-4-6']];
    const fallback = id % 2 === 0;
    const tries = [];
    if (elapsed >= 1000) tries.push({ id: 'seat-0', model: models[0][1], start: new Date(start + 1000).toISOString(),
      done: fallback ? elapsed >= 4000 : done, status: fallback && elapsed >= 4000 ? 429 : done ? 200 : 0,
      rest: fallback && elapsed >= 4000 ? {} : undefined, ms: Math.min(elapsed - 1000, fallback ? 3000 : 8500) });
    if (fallback && elapsed >= 5000) tries.push({ id: 'seat-1', model: models[1][1], start: new Date(start + 5000).toISOString(),
      done, status: done ? 200 : 0, ms: Math.min(elapsed - 5000, 4500) });
    return { id, seq: Math.floor(now / 500), time: new Date(start).toISOString(), agent: 'Demo agent', model: `group/${group}`,
      group: { id: group, ref: `group/${group}`, name: group, routing: group === 'fast' ? 'weight' : 'order' },
      order: models.map(([provider, model], index) => ({ id: `seat-${index}`, provider, model })),
      tries, done, status: done ? 200 : 0, ms: Math.min(elapsed, 9500), usage: done ? [{ in: 1200, out: 320 }] : [] };
  });
  return { ...projectTrace({ seq: Math.floor(now / 500), mine: true, now: new Date(now).toISOString(), routes, ids: routes.map(route => route.id),
    totals: { requests: 2, ok: 1, failed: 0, rerouted: current % 2 === 0 ? 1 : 0 } }), mode: 'demo', reset: false };
}
