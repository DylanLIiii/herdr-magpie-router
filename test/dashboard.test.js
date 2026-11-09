import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { DashboardSource, routeGroups, usageSummary } from '../server/dashboard.js';
import { createApp } from '../server/index.js';

const env = { MAGPIE_WEB_URL: 'http://192.0.2.20:3430', MAGPIE_WEB_KEY: 'test-only-web-access-key' };
const secret = 'must-not-reach-dashboard';
const summary = period => ({ period, calls: 2000, errors: 3, input: 120000, output: 60000, cache_read: 80000, cache_write: 1000, cost: 2.5, unpriced: 12,
  path: secret, sessions: [secret], accounts: [secret], providerKeys: [secret],
  models: [{ id: 'provider/model', provider: 'provider', model: 'model', calls: 2000, input: 120000, output: 60000, host: secret }] });
const now = () => new Date().toISOString();
const route = () => ({ id: 123, time: now(), model: 'auto/coding', group: { id: 'coding', name: 'Coding', routing: 'priority' },
  order: [{ id: 'candidate', provider: 'provider', name: 'Provider', model: 'model' }],
  tries: [{ id: 'candidate', model: 'model', status: 200, done: true, ms: 50 }], status: 200, done: true,
  session: secret, cwd: secret, usage: [{ in: 10, out: 5 }] });
const groupData = { groups: [{ id: 'coding', name: 'Coding', ref: 'auto/coding', routing: 'priority', ready: true,
  off: ['provider/off'], memberInfo: [{ id: 'provider/model', provider: 'provider', model: 'model', ready: true }, { id: 'provider/off', provider: 'provider', model: 'off', ready: true }], prompt: secret }], accounts: { key: secret } };

function upstream(calls = []) {
  return async (url, options) => {
    calls.push({ url, options });
    switch (url.pathname) {
      case '/api/gateway/trace': return Response.json({ routes: [route()] });
      case '/api/gateway/history': return Response.json({ routes: [route()], cut: false });
      case '/api/usage/requests': return Response.json({ rows: [{ route_id: 123, t: now(), provider: 'provider', model: 'model', in: 10, out: 5, status: 200 }] });
      case '/api/groups': return Response.json(groupData);
      case '/api/usage': return Response.json(summary(url.searchParams.get('period')));
      default: throw new Error(`Unexpected URL: ${url.pathname}`);
    }
  };
}

test('remote web authentication uses its port cookie, GET only, with no local history or secret leakage', async () => {
  const calls = [];
  const source = new DashboardSource({ env, fetchImpl: upstream(calls), historyReader: () => { throw new Error('Remote service cannot read local history'); } });
  const data = await source.dashboard('7d', 'Asia/Shanghai');
  assert.equal(data.connection, 'connected');
  assert.equal(data.service.url, env.MAGPIE_WEB_URL);
  assert.equal(data.requests.length, 1, 'trace and remote history join by route identity');
  assert.equal(data.usage.calls, 2000, 'full-period summary is independent of bounded request list');
  assert.equal(data.usage.cache_read, 80000);
  assert.equal(data.configuredGroups[0].members[1].enabled, false);
  assert.equal(data.configuredGroups[0].strategy, 'priority');
  assert.doesNotMatch(JSON.stringify(data), new RegExp(`${secret}|${env.MAGPIE_WEB_KEY}`));
  assert.equal(calls.length, 5);
  for (const { url, options } of calls) {
    assert.equal(url.origin, env.MAGPIE_WEB_URL);
    assert.equal(options.method, 'GET');
    assert.equal(options.headers.Cookie, `magpie_web_3430=${env.MAGPIE_WEB_KEY}`);
    assert.equal(options.headers.Authorization, undefined);
    assert.equal(options.redirect, 'error');
  }
  assert.equal(calls.find(call => call.url.pathname === '/api/usage').url.searchParams.get('tz'), 'Asia/Shanghai');
  await source.dashboard('7d', 'Asia/Shanghai');
  assert.equal(calls.length, 5, 'repeated reads share cached results');
});

test('reverse proxies use the configured internal listen port, without forwarding the gateway key', async () => {
  const calls = [];
  const source = new DashboardSource({ env: { ...env, MAGPIE_WEB_URL: 'https://magpie.example', MAGPIE_WEB_COOKIE_PORT: '3430', MAGPIE_API_KEY: 'gateway-test-key' }, fetchImpl: upstream(calls) });
  await source.dashboard();
  assert.ok(calls.every(call => call.options.headers.Cookie.startsWith('magpie_web_3430=')));
  assert.ok(calls.every(call => !JSON.stringify(call.options.headers).includes('gateway-test-key')));
});

test('auth failures never turn into a connected empty dashboard or expose server error text', async () => {
  const source = new DashboardSource({ env, fetchImpl: async () => new Response(secret, { status: 401 }) });
  await assert.rejects(source.dashboard(), error => /认证失败/.test(error.message) && !error.message.includes(secret));
});

test('a missing groups API is partial data; empty valid groups and zero usage are preserved', async () => {
  const fetchImpl = upstream();
  const source = new DashboardSource({ env, fetchImpl: (url, options) => url.pathname === '/api/groups' ? Promise.resolve(new Response('', { status: 404 })) : fetchImpl(url, options) });
  const data = await source.dashboard('30d');
  assert.equal(data.connection, 'partial');
  assert.equal(data.configuredGroups, null);
  assert.equal(data.usage.period, '30d');
  assert.match(data.warnings.join(' '), /Route configuration/);
  assert.deepEqual(routeGroups({ groups: [] }), []);
  assert.equal(usageSummary({ period: 'today', calls: 0, input: 0 }, 'today').input, 0);
  assert.equal(usageSummary({ period: 'today', calls: 0 }, 'today').output, null);
  assert.throws(() => usageSummary(summary('all'), 'today'), /incompatible/);
});

test('remote gateway usage cannot merge this machine\'s history', async () => {
  let directory;
  const source = new DashboardSource({ env: { MAGPIE_URL: 'http://192.0.2.20:3425', MAGPIE_HISTORY_DIR: '/private/local/history' },
    historyReader: async value => { directory = value; return { routes: [], available: false }; },
    fetchImpl: async url => Response.json(url.pathname.endsWith('/trace') ? { routes: [] } : { rows: [] }) });
  await source.snapshot();
  assert.equal(directory, '');
});

test('management URL and cookie configuration reject ambiguous or unsafe input', () => {
  for (const config of [
    { ...env, MAGPIE_WEB_URL: `${env.MAGPIE_WEB_URL}/?k=secret` },
    { ...env, MAGPIE_WEB_URL: `${env.MAGPIE_WEB_URL}/some/path` },
    { ...env, MAGPIE_WEB_KEY: 'bad; injected=value' },
    { ...env, MAGPIE_WEB_COOKIE_PORT: '3430\r\nX:bad' },
    { ...env, MAGPIE_WEB_KEY: '' },
  ]) assert.throws(() => new DashboardSource({ env: config }));
});

test('dashboard HTTP endpoint defaults to live, validates periods, and demo never reads a service', async t => {
  let calls = 0;
  const app = createApp({ port: 14319, source: { configured: true, service: { url: 'http://192.0.2.20:3430' },
    async dashboard(period, zone) { calls++; return { mode: 'live', period, zone }; } } });
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => app.close(resolve)));
  const get = path => new Promise((resolve, reject) => {
    const req = request(`http://127.0.0.1:${app.address().port}${path}`, { headers: { Host: 'localhost:14319' } }, response => {
      let body = '';
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, json: () => JSON.parse(body) }));
    });
    req.on('error', reject); req.end();
  });
  assert.equal((await (await get('/api/dashboard')).json()).mode, 'live');
  assert.equal(calls, 1);
  const demo = await (await get('/api/dashboard?mode=demo&period=7d')).json();
  assert.equal(demo.mode, 'demo');
  assert.equal(demo.period, '7d');
  assert.equal(calls, 1);
  assert.equal((await get('/api/dashboard?period=forever')).status, 400);
  assert.equal((await get('/api/dashboard?tz=%0A')).status, 400);
});

test('authenticated remote integration works against an actual HTTP listener', async t => {
  const mock = createServer(async (request, response) => {
    if (request.headers.cookie !== 'magpie_web_3430=test-only-web-access-key') { response.writeHead(401).end(); return; }
    const result = await upstream()(new URL(request.url, 'http://localhost'), {});
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(await result.text());
  });
  await new Promise(resolve => mock.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => mock.close(resolve)));
  const source = new DashboardSource({ env: { ...env, MAGPIE_WEB_URL: `http://127.0.0.1:${mock.address().port}`, MAGPIE_WEB_COOKIE_PORT: '3430' } });
  const data = await source.dashboard('today');
  assert.equal(data.connection, 'connected');
  assert.equal(data.usage.calls, 2000);
});
