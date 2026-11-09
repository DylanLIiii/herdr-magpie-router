import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { demoSnapshot, demoDashboard } from './demo.js';
import { DashboardSource, PERIODS } from './dashboard.js';
import { demoTrace } from './demo-trace.js';
import { setTimeout as delay } from 'node:timers/promises';
import { Connections, ConnectionError } from './connection.js';

const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/icons.svg', ['icons.svg', 'image/svg+xml']],
]);

export function disconnectedSnapshot(error, configured = false) {
  return {
    mode: 'live', connection: configured ? 'disconnected' : 'unconfigured',
    updatedAt: new Date().toISOString(),
    source: { label: 'Magpie', detail: configured ? '无法读取 Magpie，请检查连接和认证配置' : '请在本地 .env 设置 MAGPIE_WEB_URL / MAGPIE_WEB_KEY（或 MAGPIE_URL）后重启面板' },
    error, requests: [], groups: [], providers: [],
  };
}

async function readSettings(request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] || '')) throw new ConnectionError('JSON content required.', 415);
  if (Number(request.headers['content-length']) > 8192) throw new ConnectionError('Connection settings are too large.', 413);
  const chunks = []; let size = 0;
  const timer = setTimeout(() => request.destroy(), 10000);
  try {
    for await (const chunk of request) {
      size += chunk.length;
      if (size > 8192) throw new ConnectionError('Connection settings are too large.', 413);
      chunks.push(chunk);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw new ConnectionError('Invalid connection settings JSON.'); }
  } finally { clearTimeout(timer); }
}

/** Remote Magpie access stays read-only; only local connection settings can be saved. */
export function createApp({ source, connections = null, port = 4317 } = {}) {
  source ||= connections?.source || new DashboardSource();
  const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]);
  const traceControllers = new Set();
  const unsubscribe = connections?.onChange(() => { for (const controller of traceControllers) controller.abort(); });
  const app = createServer(async (request, response) => {
    const headers = {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self' http://localhost:* http://127.0.0.1:* tauri://localhost https://tauri.localhost",
    };
    const send = (status, body, type = 'application/json; charset=utf-8') => {
      response.writeHead(status, { ...headers, 'Content-Type': type });
      response.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
    };
    if (!allowedHosts.has(request.headers.host)) return send(403, { error: 'Loopback Host required' });
    if (request.headers.origin) {
      try {
        const origin = new URL(request.headers.origin);
        if (!allowedHosts.has(origin.host) || origin.protocol !== 'http:') return send(403, { error: 'Same-origin request required' });
      } catch { return send(403, { error: 'Invalid Origin' }); }
    }
    if (request.headers['sec-fetch-site'] === 'cross-site') return send(403, { error: 'Same-origin request required' });
    let url;
    try { url = new URL(request.url, `http://127.0.0.1:${port}`); }
    catch { return send(400, { error: 'Invalid URL' }); }
    if (url.pathname === '/api/connection' || url.pathname === '/api/connection/test') {
      if (!connections) return send(503, { error: 'Connection settings require an updated local bridge.' });
      if (request.method === 'GET' && url.pathname === '/api/connection') return send(200, connections.info());
      if (request.method !== 'POST') { response.setHeader('Allow', 'GET, POST'); return send(405, { error: 'Use POST to test or save local settings.' }); }
      if (!connections.authorizes(request.headers['x-magpie-config-token'])) return send(403, { error: 'Reopen Connection before saving settings.' });
      try {
        const input = await readSettings(request);
        const result = url.pathname.endsWith('/test') ? await connections.test(input) : await connections.save(input);
        if (!response.destroyed) return send(200, result);
      } catch (error) {
        if (!response.destroyed) return send(error instanceof ConnectionError ? error.status : 500,
          { error: error instanceof ConnectionError ? error.message : 'Local connection settings are unavailable.' });
      }
      return;
    }
    if (request.method !== 'GET') {
      response.setHeader('Allow', 'GET');
      return send(405, { error: 'Magpie data endpoints are read-only' });
    }
    // Pin this response to one source; a concurrent save cannot mix services.
    const activeSource = connections?.source || source, revision = connections?.revision;
    const current = () => !connections || revision === connections.revision;
    const changed = () => send(409, { error: 'Connection changed. Refresh to read the selected service.' });
    if (url.pathname === '/api/routing') {
      const after = Number(url.searchParams.get('after') || '0'), epoch = url.searchParams.get('epoch') || '';
      const mode = url.searchParams.get('mode') || 'live', wait = url.searchParams.get('wait') === '1';
      if (!Number.isSafeInteger(after) || after < 0 || !/^[a-zA-Z0-9_-]{0,64}$/.test(epoch) || !['live', 'demo'].includes(mode)) {
        return send(400, { error: 'Invalid routing cursor or mode' });
      }
      const abort = new AbortController();
      traceControllers.add(abort);
      response.on('close', () => { traceControllers.delete(abort); if (!response.writableEnded) abort.abort(); });
      try {
        if (mode === 'demo') {
          if (wait) await delay(500, null, { signal: abort.signal });
          return send(200, demoTrace());
        }
        if (!activeSource.configured) return send(503, { error: 'Open Connection to set the Magpie address and Web key.' });
        const frame = await activeSource.trace({ after, epoch, wait, signal: abort.signal });
        if (!response.destroyed) return current() ? send(200, { ...frame, mode: 'live', connectionRevision: revision }) : changed();
      } catch (error) {
        if (!response.destroyed) return current() ? send(503, { error: error.publicMessage || 'Live routing is unavailable. Reconnecting…' }) : changed();
      } finally { traceControllers.delete(abort); }
      return;
    }
    if (url.pathname === '/api/dashboard') {
      const mode = url.searchParams.get('mode') || 'live';
      const period = url.searchParams.get('period') || 'today';
      const zone = url.searchParams.get('tz') || '';
      if (!['demo', 'live'].includes(mode) || !PERIODS.includes(period) || zone.length > 100 || !/^[A-Za-z0-9_+/:.-]*$/.test(zone)) {
        return send(400, { error: 'Invalid mode, usage period or time zone' });
      }
      if (mode === 'demo') return send(200, demoDashboard(period));
      const unavailable = error => ({
        ...disconnectedSnapshot(error, activeSource.configured), period, usage: null,
        configuredGroups: null, service: activeSource.service || null, warnings: [], connectionRevision: revision,
      });
      if (!activeSource.configured) return send(503, unavailable('Open Connection to set your Magpie service address and Web key.'));
      try {
        const data = await activeSource.dashboard(period, zone);
        return current() ? send(200, { ...data, connectionRevision: revision }) : changed();
      }
      catch (error) { return current() ? send(503, unavailable(error.publicMessage || 'Cannot reach Magpie. Check the service address and access key.')) : changed(); }
    }
    if (url.pathname === '/api/snapshot') {
      const mode = url.searchParams.get('mode') || 'demo';
      if (mode === 'demo') return send(200, demoSnapshot());
      if (mode !== 'live') return send(400, { error: 'mode must be demo or live' });
      if (!activeSource.configured) return send(503, disconnectedSnapshot('尚未配置 Magpie 数据源'));
      try { const data = await activeSource.snapshot(); return current() ? send(200, data) : changed(); }
      catch (error) { return current() ? send(503, disconnectedSnapshot(error.publicMessage || 'Magpie 连接失败，请检查服务状态', true)) : changed(); }
    }
    if (url.pathname === '/health') return send(200, { status: 'ok', readOnly: true });
    const asset = assets.get(url.pathname);
    if (!asset) return send(404, { error: 'Not found' });
    try {
      return send(200, await readFile(new URL(`../public/${asset[0]}`, import.meta.url)), asset[1]);
    } catch { return send(404, { error: 'Asset not found' }); }
  });
  app.on('close', () => { unsubscribe?.(); for (const controller of traceControllers) controller.abort(); });
  return app;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT || 4317);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535');
  const connections = await Connections.open();
  const app = createApp({ port, connections });
  app.on('error', error => { console.error(`Panel failed to start: ${error.code || 'server error'}`); process.exitCode = 1; });
  app.listen(port, '127.0.0.1', () => console.log(`Magpie Router · http://127.0.0.1:${port}\nDemo: ?mode=demo · Live: ?mode=live · Embed: ?embed=1`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => app.close(() => process.exit(0)));
}
