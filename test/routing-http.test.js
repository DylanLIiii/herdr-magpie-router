import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request, createServer } from 'node:http';
import { once } from 'node:events';
import { createApp } from '../server/index.js';
import { DashboardSource } from '../server/dashboard.js';

async function host(t, source) {
  const app = createApp({ port: 14349, source });
  app.listen(0, '127.0.0.1'); await once(app, 'listening');
  t.after(() => new Promise(resolve => { app.closeAllConnections(); app.close(resolve); }));
  const options = path => ({ hostname: '127.0.0.1', port: app.address().port, path, headers: { Host: 'localhost:14349' } });
  const get = path => new Promise((resolve, reject) => {
    const req = request(options(path), response => {
      let text = ''; response.on('data', chunk => { text += chunk; });
      response.on('end', () => resolve({ code: response.statusCode, body: JSON.parse(text) }));
    }); req.on('error', reject); req.end();
  });
  return { options, get };
}

test('live routing endpoint forwards cursor and wait, while demo uses no upstream and bad cursors are rejected', async t => {
  const calls = [];
  const { get } = await host(t, { configured: true, trace: async options => { calls.push(options); return { seq: 12, epoch: 'owner', mine: true, routes: [], ids: [] }; } });
  const live = await get('/api/routing?mode=live&after=9&epoch=owner&wait=1');
  assert.equal(live.code, 200); assert.equal(live.body.mode, 'live'); assert.equal(live.body.seq, 12);
  assert.equal(calls[0].after, 9); assert.equal(calls[0].epoch, 'owner'); assert.equal(calls[0].wait, true);
  assert.equal(calls[0].signal.aborted, false);
  assert.equal((await get('/api/routing?mode=demo')).body.mode, 'demo');
  assert.equal(calls.length, 1);
  for (const query of ['after=-1', 'after=bad', 'after=1.3', 'epoch=%0A', 'mode=other']) assert.equal((await get(`/api/routing?${query}`)).code, 400);
});

test('closing a waiting client cancels its upstream request', async t => {
  let entered, aborted;
  const started = new Promise(resolve => { entered = resolve; });
  const cancelled = new Promise(resolve => { aborted = resolve; });
  const { options } = await host(t, { configured: true, trace: ({ signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => { aborted(); reject(new Error('cancelled')); }, { once: true });
    entered();
  }) });
  const req = request(options('/api/routing?after=10&wait=1'));
  req.on('error', () => {}); req.end();
  await started; req.destroy(); await cancelled;
});

test('authenticated live service changes travel through a real held HTTP request without a snapshot timer', async t => {
  let seq = 1, held, waiting;
  const arrived = new Promise(resolve => { waiting = resolve; });
  const route = () => ({ id: 7, seq, time: '2026-11-09T12:00:00Z', model: 'group/g', group: { id: 'g' },
    provider: 'p', done: seq === 2, status: seq === 2 ? 200 : 0,
    tries: [{ id: 'seat', model: 'm', done: seq === 2, status: seq === 2 ? 200 : 0 }] });
  const upstream = createServer((req, res) => {
    assert.equal(req.headers.cookie, 'magpie_web_3430=test-only-web-access-key');
    const query = new URL(req.url, 'http://localhost');
    assert.equal(query.pathname, '/api/gateway/trace');
    const reply = () => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ seq, mine: true, routes: [route()], ids: [7] })); };
    if (query.searchParams.get('after') === '1' && query.searchParams.get('wait') === '1') {
      held = reply; waiting();
    } else reply();
  });
  upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening');
  t.after(() => new Promise(resolve => { upstream.closeAllConnections(); upstream.close(resolve); }));
  const source = new DashboardSource({ env: { MAGPIE_WEB_URL: `http://127.0.0.1:${upstream.address().port}`,
    MAGPIE_WEB_COOKIE_PORT: '3430', MAGPIE_WEB_KEY: 'test-only-web-access-key' } });
  const { get } = await host(t, source);
  const first = await get('/api/routing?after=0');
  assert.equal(first.body.routes[0].attempts[0].done, false);
  let delivered = false;
  const second = get(`/api/routing?after=1&epoch=${first.body.epoch}&wait=1`).then(result => { delivered = true; return result; });
  await arrived;
  assert.equal(delivered, false, 'the client is waiting for a gateway change');
  seq = 2; held();
  const completed = await second;
  assert.equal(completed.body.seq, 2);
  assert.equal(completed.body.routes[0].done, true);
  assert.equal(completed.body.routes[0].attempts[0].status, 'success');
});

test('live routing failures stay errors and never disclose an upstream error body', async t => {
  const { get } = await host(t, { configured: true, trace: async () => { throw new Error('private-key-in-upstream-body'); } });
  const result = await get('/api/routing');
  assert.equal(result.code, 503);
  assert.doesNotMatch(JSON.stringify(result.body), /private-key/);
  assert.equal(result.body.routes, undefined);
});
