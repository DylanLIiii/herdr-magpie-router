import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, request } from 'node:http';
import { once } from 'node:events';
import { Connections } from '../server/connection.js';
import { createApp } from '../server/index.js';

const secret = label => `${label}-${'fixture'.repeat(5)}`;
async function storage(t) {
  const dir = await mkdtemp(join(tmpdir(), 'magpie-connection-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return join(dir, 'private', 'connection.json');
}
const draft = (manager, extra = {}) => ({ url: 'http://127.0.0.1:3430', key: secret('web'), cookiePort: '', revision: manager.info().revision, ...extra });
const okay = async url => Response.json(String(url).includes('/trace') ? { seq: 1, mine: true, routes: [], ids: [] }
  : String(url).includes('/groups') ? { groups: [] } : { period: 'today', calls: 0 });

async function http(t, connections) {
  const app = createApp({ port: 14348, connections });
  app.listen(0, '127.0.0.1'); await once(app, 'listening');
  t.after(() => new Promise(resolve => { app.closeAllConnections(); app.close(resolve); }));
  return (path, options = {}) => new Promise((resolve, reject) => {
    const { body, ...rest } = options;
    const req = request({ hostname: '127.0.0.1', port: app.address().port, path,
      ...rest, headers: { Host: 'localhost:14348', ...options.headers } }, res => {
      let data = ''; res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(data) }));
    });
    req.on('error', reject); req.end(body);
  });
}
const post = (manager, value, headers = {}) => ({ method: 'POST', headers: { 'Content-Type': 'application/json',
  'X-Magpie-Config-Token': manager.info().token, ...headers }, body: JSON.stringify(value) });

test('test is non-mutating; save is private, key is write-only, and restart restores the connection', async t => {
  const file = await storage(t), calls = [];
  const manager = await Connections.open({ env: {}, file, fetchImpl: async (url, options) => { calls.push({ url, options }); return okay(url); } });
  const input = draft(manager);
  assert.equal((await manager.test(input)).ok, true);
  assert.equal(manager.source.configured, false);
  await assert.rejects(readFile(file), { code: 'ENOENT' });
  assert.equal(calls.length, 3);
  assert.ok(calls.every(call => call.options.method === 'GET' && call.options.headers.Cookie === `magpie_web_3430=${input.key}`));
  const info = await manager.save(input);
  assert.equal(info.hasKey, true); assert.equal(info.saved, true);
  assert.equal(JSON.stringify(info).includes(input.key), false);
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  const saved = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(saved.key, input.key);
  const restored = await Connections.open({ env: {}, file, fetchImpl: okay });
  assert.equal(restored.info().url, input.url); assert.equal(restored.info().hasKey, true);
  assert.equal((await restored.test(draft(restored, { key: '' }))).ok, true);
});

test('blank key is retained only for the same normalized origin and changing origin never sends it', async t => {
  const manager = await Connections.open({ env: {}, file: await storage(t), fetchImpl: okay });
  await manager.save(draft(manager));
  await manager.save(draft(manager, { url: 'http://127.0.0.1:3430/', key: '', cookiePort: '03430' }));
  assert.equal(manager.info().cookiePort, '3430');
  await assert.rejects(manager.test(draft(manager, { url: 'https://different.example:3430', key: '' })), /new Web key/);
  await assert.rejects(manager.save(draft(manager, { url: 'http://127.0.0.1:3431', key: '' })), /new Web key/);
  assert.equal(manager.info().url, 'http://127.0.0.1:3430');
});

test('a reverse proxy prefix is retained for test, save, restart and every authenticated API request', async t => {
  const paths = [], key = secret('prefix');
  const upstream = createServer((req, res) => {
    paths.push(req.url);
    if (!req.url.startsWith('/mac/api/') || req.headers.cookie !== `magpie_web_3430=${key}`) {
      res.writeHead(404); res.end(); return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(req.url.includes('trace') ? { seq: 1, mine: true, routes: [] }
      : req.url.includes('groups') ? { groups: [] } : { period: 'today', calls: 0 }));
  });
  upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening');
  t.after(() => new Promise(resolve => { upstream.closeAllConnections(); upstream.close(resolve); }));
  const file = await storage(t), manager = await Connections.open({ env: {}, file });
  const url = `http://127.0.0.1:${upstream.address().port}/mac/`;
  const input = draft(manager, { url, key, cookiePort: '3430' });
  assert.equal((await manager.test(input)).partial, false);
  await manager.save(input);
  assert.equal(manager.info().url, url.slice(0, -1));
  const restored = await Connections.open({ env: {}, file });
  const retained = draft(restored, { url: url.slice(0, -1), key: '', cookiePort: '3430' });
  assert.equal((await restored.test(retained)).partial, false);
  assert.equal(restored.source.service.url, url.slice(0, -1));
  assert.ok(paths.includes('/mac/api/gateway/trace?after=0'));
  assert.ok(paths.includes('/mac/api/usage?period=today'));
  await assert.rejects(restored.test({ ...retained, url: url.replace('/mac/', '/other/') }), /new Web key/);
});

test('validation errors, stale writers and persistence failure leave the previous source intact', async t => {
  const manager = await Connections.open({ env: {}, file: await storage(t), fetchImpl: okay });
  for (const extra of [{ url: 'file:///tmp/config' }, { url: 'https://host/#fragment' }, { url: 'https://host/?token=bad' },
    { url: 'https://user:secret@host' }, { cookiePort: '99999' }, { key: 'short' }]) await assert.rejects(manager.save(draft(manager, extra)));
  const originalDraft = draft(manager);
  await manager.save(originalDraft);
  const old = manager.source;
  await assert.rejects(manager.save(originalDraft), /changed/);
  manager.persist = async () => { throw new Error('secret disk details'); };
  await assert.rejects(manager.save(draft(manager, { url: 'http://localhost:3430' })), /previous connection is unchanged/);
  assert.equal(manager.source, old); assert.equal(manager.info().revision, 1);
});

test('environment is a fallback, saved settings take precedence, incomplete input can be fixed in the UI', async t => {
  const file = await storage(t);
  const manager = await Connections.open({ env: { MAGPIE_WEB_URL: 'http://old.example:3430', MAGPIE_WEB_KEY: secret('env') }, file, fetchImpl: okay });
  assert.equal(manager.info().origin, 'environment');
  await manager.save(draft(manager));
  const restored = await Connections.open({ env: { MAGPIE_WEB_URL: 'http://old.example:3430', MAGPIE_WEB_KEY: secret('env') }, file, fetchImpl: okay });
  assert.equal(restored.info().url, 'http://127.0.0.1:3430');
  const broken = await Connections.open({ env: { MAGPIE_WEB_URL: 'invalid' }, file: `${file}.other`, fetchImpl: okay });
  assert.equal(broken.info().configured, false); assert.match(broken.info().notice, /incomplete/);
  await writeFile(file, '{broken');
  const corrupt = await Connections.open({ env: {}, file, fetchImpl: okay });
  assert.match(corrupt.info().notice, /could not be read/);
  await corrupt.save(draft(corrupt)); assert.equal(corrupt.info().saved, true);
});

test('connection API requires same origin, token and JSON; secrets never come back in responses', async t => {
  const manager = await Connections.open({ env: {}, file: await storage(t), fetchImpl: okay });
  const send = await http(t, manager), input = draft(manager);
  const metadata = await send('/api/connection');
  assert.equal(metadata.status, 200); assert.equal(metadata.body.hasKey, false);
  assert.equal((await send('/api/connection', post(manager, input, { Origin: 'https://evil.example' }))).status, 403);
  assert.equal((await send('/api/connection', post(manager, input, { 'Sec-Fetch-Site': 'cross-site' }))).status, 403);
  assert.equal((await send('/api/connection', post(manager, input, { 'X-Magpie-Config-Token': 'wrong' }))).status, 403);
  assert.equal((await send('/api/connection', post(manager, input, { 'Content-Type': 'text/plain' }))).status, 415);
  assert.equal((await send('/api/connection', { ...post(manager, input), body: '{bad' })).status, 400);
  const huge = post(manager, { ...input, key: 'k'.repeat(9000) }); huge.headers['Content-Length'] = Buffer.byteLength(huge.body);
  assert.equal((await send('/api/connection', huge)).status, 413);
  assert.equal((await send('/api/dashboard', post(manager, input))).status, 405);
  assert.equal(manager.info().revision, 0);
  const result = await send('/api/connection', post(manager, input));
  assert.equal(result.status, 200); assert.equal(result.body.hasKey, true);
  assert.equal(JSON.stringify(result.body).includes(input.key), false);
  const check = await send('/api/connection/test', post(manager, draft(manager, { key: '' })));
  assert.equal(check.status, 200); assert.equal(JSON.stringify(check.body).includes(input.key), false);
  const forbiddenHost = await send('/api/connection', { headers: { Host: 'evil.example' } });
  assert.equal(forbiddenHost.status, 403);
});

test('switching service cancels old long polls, rejects late dashboards, and sends only the new key to the new origin', async t => {
  let releaseDashboard, startedDashboard, startedTrace;
  const dashboardStarted = new Promise(resolve => { startedDashboard = resolve; });
  const traceStarted = new Promise(resolve => { startedTrace = resolve; });
  let aborted = false;
  const calls = [];
  const manager = await Connections.open({ env: {}, file: await storage(t), fetchImpl: async (url, options) => { calls.push({ url: String(url), cookie: options.headers.Cookie }); return okay(url); } });
  await manager.save(draft(manager));
  manager.source.dashboard = () => { startedDashboard(); return new Promise(resolve => { releaseDashboard = resolve; }); };
  manager.source.trace = ({ signal }) => new Promise((resolve, reject) => { startedTrace(); signal.addEventListener('abort', () => { aborted = true; reject(new Error('old service')); }, { once: true }); });
  const send = await http(t, manager);
  const oldDashboard = send('/api/dashboard'), oldTrace = send('/api/routing?after=1&wait=1');
  await Promise.all([dashboardStarted, traceStarted]);
  const next = draft(manager, { url: 'http://second.example:4430', key: secret('second') });
  const saved = await send('/api/connection', post(manager, next));
  assert.equal(saved.status, 200); assert.equal(aborted, true);
  releaseDashboard({ mode: 'live', oldData: true });
  assert.equal((await oldTrace).status, 409);
  const late = await oldDashboard; assert.equal(late.status, 409); assert.equal(late.body.oldData, undefined);
  const current = await send('/api/routing');
  assert.equal(current.status, 200); assert.equal(current.body.connectionRevision, 2);
  assert.ok(calls.every(call => call.url.startsWith(next.url) && call.cookie === `magpie_web_4430=${next.key}`));
});

test('connection test authenticates against a real Magpie-shaped listener without mutating settings', async t => {
  const key = secret('listener');
  const upstream = createServer((req, res) => {
    if (req.headers.cookie !== `magpie_web_3430=${key}`) { res.writeHead(401); res.end('private upstream body'); return; }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(req.url.includes('trace') ? { seq: 1, mine: true, routes: [] } : req.url.includes('groups') ? { groups: [] } : { period: 'today', calls: 0 }));
  });
  upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening');
  t.after(() => new Promise(resolve => { upstream.closeAllConnections(); upstream.close(resolve); }));
  const manager = await Connections.open({ env: {}, file: await storage(t) });
  const input = draft(manager, { url: `http://127.0.0.1:${upstream.address().port}`, key, cookiePort: '3430' });
  const checked = await manager.test(input); assert.equal(checked.partial, false); assert.equal(checked.routingActive, true);
  await assert.rejects(manager.test({ ...input, key: secret('wrong') }), /Cannot connect/);
  assert.equal(manager.info().configured, false);
});
