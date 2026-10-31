import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSnapshot } from '../server/normalize.js';
import { MagpieSource } from '../server/magpie.js';

const now = Date.parse('2026-10-31T12:00:00Z');
const time = '2026-10-31T11:59:00Z';
const route = {
  id: 77, time, model: 'group/coding', provider: 'first', done: true, status: 200, ms: 2600,
  group: { id: 'coding', name: 'Coding', routing: 'order', members: ['first/model-a', 'second/model-b'] },
  order: [{ id: 'seat-a', provider: 'first', name: 'First provider', model: 'model-a', who: 'private-account' }],
  left: [{ id: 'seat-b', provider: 'second', model: 'model-b' }],
  tries: [{ id: 'seat-a', model: 'model-a', status: 429, fail: 'private-token private-prompt', done: true, ms: 400 }, { id: 'seat-b', model: 'model-b', status: 200, done: true, ms: 2200 }],
  session: 'private-session', folder: 'private-folder', prompt: { text: 'private-prompt' },
};

test('attempt provider is resolved by seat, failures imply fallback only with a later attempt', () => {
  const data = normalizeSnapshot({ now, sourceKind: 'trace', routes: [route] });
  const request = data.requests[0];
  assert.equal(request.provider, 'second');
  assert.equal(request.model, 'model-b');
  assert.equal(request.fallback, true);
  assert.equal(request.attempts[0].provider, 'first');
  assert.equal(request.attempts[0].error, 'HTTP 429');
  assert.equal(data.providers.find(provider => provider.id === 'first').errors, 1);
  assert.equal(data.groups[0].strategy, 'order');
  const serialized = JSON.stringify(data);
  for (const privateField of ['private-account', 'private-token', 'private-prompt', 'private-session', 'private-folder']) assert.ok(!serialized.includes(privateField));
  const failure = normalizeSnapshot({ now, sourceKind: 'trace', routes: [{ ...route, tries: [route.tries[0]], status: 429 }] });
  assert.equal(failure.requests[0].fallback, false);
  assert.equal(failure.requests[0].status, 'error');
});

test('joins usage by route_id and preserves explicit zero while unknown data stays null', () => {
  const data = normalizeSnapshot({ now, sourceKind: 'history', routes: [route], rows: [{ route_id: 77, t: time, provider: 'second', in: 0, out: 18, ms: 2700, ttft_ms: 200 }] });
  assert.equal(data.requests.length, 1);
  assert.equal(data.requests[0].inputTokens, 0);
  assert.equal(data.requests[0].outputTokens, 18);
  assert.equal(data.requests[0].durationMs, 2700);
  assert.equal(data.requests[0].ttftMs, 200);
  const unknown = normalizeSnapshot({ now, sourceKind: 'history', routes: [{ ...route, ms: 0 }] }).requests[0];
  assert.equal(unknown.inputTokens, null);
  assert.equal(unknown.durationMs, null);
});

test('usage-only rows do not claim absence of fallback; stale and malformed rows are excluded', () => {
  const data = normalizeSnapshot({ now, sourceKind: 'usage', rows: [
    { route_id: 88, t: time, model: 'model-x', req: 'auto/x', provider: 'example', status: 200 },
    { route_id: 89, t: '2026-10-28T01:00:00Z', status: 200 },
    { route_id: 90, t: 'invalid', status: 200 },
    null,
  ] });
  assert.equal(data.requests.length, 1);
  assert.equal(data.requests[0].fallback, null);
  assert.deepEqual(data.requests[0].attempts, []);
  assert.match(data.source.detail, /无法确认回退/);
});

test('all billable tries are retained while terminal outcome and tokens are independent of response order', () => {
  const success = { route_id: 77, t: time, provider: 'second', model: 'model-b', served: 'served-b', status: 200, in: 20, out: 5 };
  const failed = { route_id: 77, t: '2026-10-31T11:58:00Z', provider: 'first', model: 'model-a', status: 429, in: 10, out: 0, handed_on: true };
  for (const rows of [[success, failed], [failed, success]]) {
    for (const routes of [[], [route]]) {
      const data = normalizeSnapshot({ now, sourceKind: routes.length ? 'history' : 'usage', rows, routes });
      assert.equal(data.requests.length, 1);
      const request = data.requests[0];
      assert.equal(request.status, 'success');
      assert.equal(request.provider, 'second');
      assert.equal(request.model, 'served-b');
      assert.equal(request.inputTokens, 30);
      assert.equal(request.outputTokens, 5);
      assert.equal(data.providers.find(provider => provider.id === 'first').errors, 1);
    }
  }
});

test('older unflagged usage records choose newest result and direct rows do not collapse', () => {
  const rows = [
    { route_id: 77, t: time, provider: 'second', model: 'b', status: 200, in: 20, out: 5 },
    { route_id: 77, t: '2026-10-31T11:58:00Z', provider: 'first', model: 'a', status: 429, in: 10, out: 0 },
    { route_id: 0, t: time, provider: 'direct', model: 'd', status: 200, in: 1, out: 1 },
    { route_id: 0, t: time, provider: 'direct', model: 'd', status: 200, in: 1, out: 1 },
  ];
  const data = normalizeSnapshot({ now, sourceKind: 'usage', rows });
  assert.equal(data.requests.length, 3);
  assert.equal(data.requests.find(row => row.id === '77').status, 'success');
  assert.equal(data.requests.find(row => row.id === '77').inputTokens, 30);
  assert.equal(new Set(data.requests.map(row => row.id)).size, 3);
});

test('older gateways fall back from missing trace to bounded disk history and usage', async () => {
  const paths = [];
  const source = new MagpieSource({
    env: { MAGPIE_URL: 'http://localhost:3425' },
    historyReader: async () => ({ routes: [{ ...route, time: new Date().toISOString() }], available: true }),
    fetchImpl: async url => {
      paths.push(url.pathname);
      if (url.pathname.endsWith('/trace')) return new Response('{}', { status: 404 });
      return Response.json({ rows: [] });
    },
  });
  const [a, b] = await Promise.all([source.snapshot(), source.snapshot()]);
  assert.equal(a.connection, 'connected');
  assert.match(a.source.detail, /本机路由历史/);
  assert.equal(a.requests[0].fallback, true);
  assert.strictEqual(a, b);
  assert.equal(paths.length, 2, 'concurrent clients share one upstream fetch');
});

test('disk history is not advertised as connected when the gateway is down', async () => {
  const source = new MagpieSource({ env: { MAGPIE_URL: 'http://localhost:3425' }, fetchImpl: async () => { throw Error('network'); }, historyReader: async () => ({ routes: [route], available: true }) });
  await assert.rejects(source.snapshot(), /连接失败/);
});

test('trace updates replace historical records and pending requests remain pending', async () => {
  const current = { ...route, time: new Date().toISOString(), done: false, status: 0, tries: [{ id: 'seat-a', model: 'model-a', done: false }] };
  const source = new MagpieSource({ env: { MAGPIE_URL: 'http://localhost:3425' }, historyReader: async () => ({ available: true, routes: [{ ...current, done: true, status: 200 }] }), fetchImpl: async url => Response.json(url.pathname.endsWith('/trace') ? { routes: [current] } : { rows: [] }) });
  const data = await source.snapshot();
  assert.equal(data.requests.length, 1);
  assert.equal(data.requests[0].status, 'pending');
  assert.match(data.source.detail, /实时 trace/);
});
