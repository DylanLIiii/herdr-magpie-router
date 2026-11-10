import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectAllowances } from '../server/allowances.js';
import { DashboardSource } from '../server/dashboard.js';
import { createApp } from '../server/index.js';
import { once } from 'node:events';
import { request } from 'node:http';
import { requestCache } from '../server/request-metrics.js';
import { projectTrace } from '../server/trace.js';

const now = Date.parse('2026-11-10T12:00:00Z');
test('vendor allowances preserve zero, unknown, wallet, text and unlimited semantics without account identities', () => {
  const value = projectAllowances([{ provider: 'codex', name: 'ChatGPT', plan: 'Plus', user: 'private@example.com',
    windows: [{ name: '5 hours', used: 24, resetSecs: 3600 }, { name: '7 days', used: 100 }, { name: 'unknown' },
      { name: 'Credits', balance: 0, unit: 'credits' }, { name: 'Extra', text: true, used: 0, display: 'Not enabled' },
      { name: 'Unlimited', unlimited: true, used: 0 }], error: 'private-token', session: 'private-session' },
    { provider: 'codex', name: 'ChatGPT', user: 'another@example.com', windows: [{ name: 'Credits', used: 25, limit: 200, amount: 50, unit: 'credits', heldBy: '7 days' }] }], now);
  const [a, b] = value.cards;
  assert.equal(a.account, 'Account 1'); assert.equal(b.account, 'Account 2');
  assert.equal(a.state, 'stale'); assert.equal(a.windows[0].remaining, 76);
  assert.equal(a.windows[0].resetsAt, '2026-11-10T13:00:00.000Z');
  assert.equal(a.windows[1].remaining, 0);
  for (const index of [2, 3, 4, 5]) assert.equal(a.windows[index].remaining, null);
  assert.equal(a.windows[3].balance, 0); assert.equal(a.windows[4].display, 'Not enabled');
  assert.equal(b.windows[0].amountLeft, 150); assert.equal(b.windows[0].heldBy, '7 days');
  assert.doesNotMatch(JSON.stringify(value), /private|example.com|another/);
  assert.throws(() => projectAllowances({ windows: [] }), /unavailable/);
  assert.deepEqual(projectAllowances([], now).cards, []);
});

test('subscriptions use the real quota endpoint with proxy prefix and never derive capacity from Magpie costs', async () => {
  const calls = [];
  const source = new DashboardSource({ env: { MAGPIE_WEB_URL: 'https://proxy.example/mac/', MAGPIE_WEB_KEY: 'fixture-key-for-quota-only', MAGPIE_WEB_COOKIE_PORT: '3430' },
    fetchImpl: async (url, options) => { calls.push({ url: String(url), method: options.method }); return Response.json([{ provider: 'claude', name: 'Claude', estimate: { cost: 8 }, balance: '$42', windows: [] }]); } });
  const result = await source.allowances(true);
  assert.deepEqual(calls, [{ url: 'https://proxy.example/mac/api/usage/quotas?asked=1', method: 'GET' }]);
  assert.equal(result.cards[0].estimated, true); assert.equal(result.cards[0].balance, '');
  assert.equal(result.cards[0].windows.length, 0);
});

test('gateway allowances unwrap the actual object/data envelope and keep the mount prefix', async () => {
  let observed;
  const source = new DashboardSource({ env: { MAGPIE_URL: 'https://proxy.example/gateway/', MAGPIE_API_KEY: 'test-key' },
    fetchImpl: async url => { observed = String(url); return Response.json({ object: 'list', data: [{ provider: 'codex', name: 'ChatGPT', windows: [{ name: '5 hours', used: 75, remaining: 25 }] }] }); } });
  const result = await source.allowances();
  assert.equal(observed, 'https://proxy.example/gateway/v1/magpie/quotas');
  assert.equal(result.cards[0].windows[0].remaining, 25);
});

test('allowance API rejects stale service responses and is read-only', async t => {
  let release, revision = 0;
  const connections = { source: { configured: true, allowances: () => new Promise(resolve => { release = resolve; }) },
    get revision() { return revision; }, onChange: () => () => {} };
  const app = createApp({ connections, port: 14371 }); app.listen(0, '127.0.0.1'); await once(app, 'listening');
  t.after(() => new Promise(resolve => { app.closeAllConnections(); app.close(resolve); }));
  const get = method => new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port: app.address().port, path: '/api/allowances', method, headers: { Host: 'localhost:14371' } }, res => {
      let body = ''; res.on('data', chunk => { body += chunk; }); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
    }); req.on('error', reject); req.end();
  });
  assert.equal((await get('POST')).status, 405);
  const pending = get('GET');
  while (!release) await new Promise(resolve => setImmediate(resolve));
  revision++; release({ cards: [{ name: 'old service' }] });
  const result = await pending;
  assert.equal(result.status, 409); assert.doesNotMatch(JSON.stringify(result), /old service/);
});

test('request cache excludes unknown vendors, sums real attempts and keeps canceled routes distinct', () => {
  assert.deepEqual(requestCache([]), { cacheReadTokens: null, cacheWriteTokens: null, cacheHit: null });
  assert.equal(requestCache([{ in: 10, cache_read: 90 }, { in: 10000, cache_unknown: true }]).cacheHit, 0.9);
  assert.equal(requestCache([{ in: 10 }]).cacheHit, 0);
  assert.equal(requestCache([{ in: 10, cache_unknown: true }]).cacheHit, null);
  const frame = projectTrace({ seq: 1, routes: [{ id: 1, agent: 'pi', done: true, canceled: true, status: 499,
    tries: [], usage: [{ in: 20, out: 1, cache_read: 80 }] }] });
  assert.equal(frame.routes[0].status, 'canceled'); assert.equal(frame.routes[0].agent, 'pi');
  assert.equal(frame.routes[0].cacheHit, 0.8);
});
