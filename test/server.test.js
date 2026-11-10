import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { createApp } from '../server/index.js';
import { demoSnapshot } from './fixtures/demo.js';

let app;
let base;
let liveCalls = 0;
before(async () => {
  app = createApp({ port: 4317, source: { configured: true, async snapshot() { liveCalls++; return { mode: 'live', requests: [] }; } } });
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${app.address().port}`;
});
after(() => new Promise(resolve => app.close(resolve)));

function get(path, headers = {}, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = request(`${base}${path}`, { method, headers: { Host: 'localhost:4317', ...headers } }, response => {
      let body = '';
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body, json: () => JSON.parse(body) }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('production endpoints reject the removed demo mode', async () => {
  for (const path of ['snapshot', 'dashboard', 'routing']) assert.equal((await get(`/api/${path}?mode=demo`)).status, 400);
  assert.equal(liveCalls, 0);
});

test('live service data is the default', async () => {
  const response = await get('/api/snapshot');
  assert.equal(response.json().mode, 'live');
  assert.equal(liveCalls, 1);
});

test('DNS rebinding hosts and cross-origin requests cannot read route data', async () => {
  assert.equal((await get('/api/snapshot', { Host: 'attacker.example' })).status, 403);
  assert.equal((await get('/api/snapshot', { Origin: 'https://attacker.example' })).status, 403);
  assert.equal((await get('/api/snapshot', { Origin: 'http://localhost:4317' })).status, 200);
});

test('only allowlisted assets and read-only endpoints are exposed', async () => {
  for (const path of ['/.env', '/server/index.js', '/package.json', '/%2e%2e/.env', '/api/proxy?url=http://example.com']) {
    assert.equal((await get(path)).status, 404, path);
  }
  assert.equal((await get('/api/snapshot', {}, 'POST')).status, 405);
  assert.equal((await get('/api/snapshot?mode=invalid')).status, 400);
  assert.equal((await get('/health')).json().readOnly, true);
});

test('fixture accounting includes failed attempts, and totals reconcile', () => {
  const snapshot = demoSnapshot(1793448000000);
  assert.equal(snapshot.requests.length, 64);
  const attempts = snapshot.requests.flatMap(row => row.attempts);
  assert.equal(snapshot.providers.reduce((sum, provider) => sum + provider.requests, 0), attempts.length);
  assert.equal(snapshot.providers.reduce((sum, provider) => sum + provider.errors, 0), attempts.filter(row => row.status === 'error').length);
  assert.ok(snapshot.requests.some(row => row.fallback));
});
