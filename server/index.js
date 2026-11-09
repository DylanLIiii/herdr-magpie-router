import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { demoSnapshot, demoDashboard } from './demo.js';
import { DashboardSource, PERIODS } from './dashboard.js';

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

/** Read-only bridge. A fixed upstream is configured by the operator, never by browser input. */
export function createApp({ source = new DashboardSource(), port = 4317 } = {}) {
  const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]);
  return createServer(async (request, response) => {
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
    if (request.method !== 'GET') {
      response.setHeader('Allow', 'GET');
      return send(405, { error: 'This panel is read-only' });
    }
    let url;
    try { url = new URL(request.url, `http://127.0.0.1:${port}`); }
    catch { return send(400, { error: 'Invalid URL' }); }
    if (url.pathname === '/api/dashboard') {
      const mode = url.searchParams.get('mode') || 'live';
      const period = url.searchParams.get('period') || 'today';
      const zone = url.searchParams.get('tz') || '';
      if (!['demo', 'live'].includes(mode) || !PERIODS.includes(period) || zone.length > 100 || !/^[A-Za-z0-9_+/:.-]*$/.test(zone)) {
        return send(400, { error: 'Invalid mode, usage period or time zone' });
      }
      if (mode === 'demo') return send(200, demoDashboard(period));
      const unavailable = error => ({
        ...disconnectedSnapshot(error, source.configured), period, usage: null,
        configuredGroups: null, service: source.service || null, warnings: [],
      });
      if (!source.configured) return send(503, unavailable('Set MAGPIE_WEB_URL and MAGPIE_WEB_KEY in the bridge .env, then restart the bridge.'));
      try { return send(200, await source.dashboard(period, zone)); }
      catch (error) { return send(503, unavailable(error.publicMessage || 'Cannot reach Magpie. Check the service address and access key.')); }
    }
    if (url.pathname === '/api/snapshot') {
      const mode = url.searchParams.get('mode') || 'demo';
      if (mode === 'demo') return send(200, demoSnapshot());
      if (mode !== 'live') return send(400, { error: 'mode must be demo or live' });
      if (!source.configured) return send(503, disconnectedSnapshot('尚未配置 Magpie 数据源'));
      try { return send(200, await source.snapshot()); }
      catch (error) { return send(503, disconnectedSnapshot(error.publicMessage || 'Magpie 连接失败，请检查服务状态', true)); }
    }
    if (url.pathname === '/health') return send(200, { status: 'ok', readOnly: true });
    const asset = assets.get(url.pathname);
    if (!asset) return send(404, { error: 'Not found' });
    try {
      return send(200, await readFile(new URL(`../public/${asset[0]}`, import.meta.url)), asset[1]);
    } catch { return send(404, { error: 'Asset not found' }); }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT || 4317);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535');
  const app = createApp({ port });
  app.on('error', error => { console.error(`Panel failed to start: ${error.code || 'server error'}`); process.exitCode = 1; });
  app.listen(port, '127.0.0.1', () => console.log(`Magpie Router · http://127.0.0.1:${port}\nDemo: ?mode=demo · Live: ?mode=live · Embed: ?embed=1`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => app.close(() => process.exit(0)));
}
