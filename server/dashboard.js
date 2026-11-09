import { MagpieSource } from './magpie.js';
import { createReader, SourceError } from './upstream.js';
import { normalizeSnapshot } from './normalize.js';

export const PERIODS = ['today', '7d', '30d', 'all'];
const list = value => Array.isArray(value) ? value.filter(item => item && typeof item === 'object') : [];
const text = value => typeof value === 'string' ? value.slice(0, 300) : '';
const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const fulfilled = result => result.status === 'fulfilled' ? result.value : null;
const totals = value => Object.fromEntries(['calls', 'errors', 'input', 'output', 'cache_read', 'cache_write', 'cost', 'unpriced']
  .map(key => [key, number(value?.[key])]));

// Deliberately project fields: management responses also contain account names,
// local paths, sessions and configuration that do not belong in this page.
export function usageSummary(value, period) {
  if (!value || value.period !== period || number(value.calls) === null) throw new SourceError('Magpie usage summary is unavailable or incompatible');
  return {
    period, since: text(value.since), ...totals(value),
    models: list(value.models).map(row => ({ model: text(row.model || row.name || row.id), provider: text(row.provider), ...totals(row) }))
      .sort((a, b) => (b.calls || 0) - (a.calls || 0)).slice(0, 20),
  };
}

export function routeGroups(value) {
  if (!value || !Array.isArray(value.groups)) throw new SourceError('Magpie route groups are unavailable or incompatible');
  return value.groups.slice(0, 200).filter(group => group && typeof group === 'object').map(group => ({
    id: text(group.id), name: text(group.name || group.id), ref: text(group.ref),
    strategy: text(group.routing) || 'default', enabled: group.disabled !== true,
    ready: typeof group.ready === 'boolean' ? group.ready : null,
    members: list(group.memberInfo).slice(0, 100).map(member => ({
      id: text(member.id), model: text(member.model || member.id), provider: text(member.provider || member.name),
      ready: typeof member.ready === 'boolean' ? member.ready : null,
      enabled: !Array.isArray(group.off) || !group.off.includes(member.id),
      group: member.group === true,
      weight: Number.isInteger(group.weights?.[member.id]) && group.weights[member.id] > 0 ? group.weights[member.id] : 1,
    })),
  }));
}

/** One fixed service per bridge; no URL or credential is accepted from a client. */
export class DashboardSource {
  constructor({ env = process.env, fetchImpl = fetch, historyReader } = {}) {
    this.web = Boolean(env.MAGPIE_WEB_URL);
    this.configured = this.web || Boolean(env.MAGPIE_URL);
    this.cache = new Map();
    if (!this.configured) return;
    const address = env.MAGPIE_WEB_URL || env.MAGPIE_URL;
    // createReader validates the origin before we construct any credential headers.
    createReader({ baseUrl: address, fetchImpl });
    const url = new URL(address);
    if (url.pathname !== '/') throw new SourceError('Magpie service URL must be an origin without a path');
    this.service = { url: url.origin, kind: this.web ? 'web' : 'gateway' };
    let headers = {};
    if (this.web) {
      const key = env.MAGPIE_WEB_KEY || '';
      if (!/^[A-Za-z0-9._~-]{16,}$/.test(key)) throw new SourceError('Set MAGPIE_WEB_KEY to the web service access key (at least 16 characters)');
      // Magpie names its cookie after the LISTEN port, which can differ from a
      // reverse proxy's external port. A gateway Bearer key cannot authenticate it.
      const port = env.MAGPIE_WEB_COOKIE_PORT || url.port || (url.protocol === 'https:' ? '443' : '80');
      if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) throw new SourceError('Invalid MAGPIE_WEB_COOKIE_PORT');
      headers = { Cookie: `magpie_web_${port}=${key}` };
    } else {
      headers = env.MAGPIE_API_KEY ? { Authorization: `Bearer ${env.MAGPIE_API_KEY}` } : {};
      // A remote service must never be joined to this computer's routing history.
      const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
      this.local = new MagpieSource({ env: { ...env, ...(!loopback ? { MAGPIE_HISTORY_DIR: 'off' } : {}) }, fetchImpl, historyReader });
    }
    this.read = createReader({ baseUrl: address, headers, fetchImpl });
  }

  cached(key, ttl, load) {
    const prior = this.cache.get(key);
    if (prior && (prior.pending || Date.now() < prior.expires)) return prior.promise;
    const entry = { pending: true, expires: 0 };
    entry.promise = Promise.resolve().then(load).then(value => {
      entry.pending = false;
      entry.expires = Date.now() + ttl;
      return value;
    }, error => { this.cache.delete(key); throw error; });
    this.cache.set(key, entry);
    return entry.promise;
  }

  snapshot() {
    if (!this.configured) return Promise.reject(new SourceError('Set MAGPIE_WEB_URL and MAGPIE_WEB_KEY in the bridge .env'));
    if (!this.web) return this.local.snapshot();
    return this.cached('snapshot', 2500, async () => {
      const [traceResult, historyResult, ledgerResult] = await Promise.allSettled([
        this.read('/api/gateway/trace?after=0'),
        this.read('/api/gateway/history'),
        this.read('/api/usage/requests?limit=500&period=all'),
      ]);
      const trace = fulfilled(traceResult), history = fulfilled(historyResult), ledger = fulfilled(ledgerResult);
      if (!Array.isArray(trace?.routes) && !Array.isArray(history?.routes) && !Array.isArray(ledger?.rows)) {
        throw [ledgerResult, traceResult, historyResult].find(result => result.status === 'rejected')?.reason || new SourceError('Incompatible Magpie route response');
      }
      const warnings = [];
      if (!Array.isArray(trace?.routes)) warnings.push('Live trace unavailable');
      if (!Array.isArray(history?.routes)) warnings.push('Retained route history unavailable');
      if (!Array.isArray(ledger?.rows)) warnings.push('Per-request usage unavailable');
      if (history?.cut) warnings.push('Retained history was truncated');
      const snapshot = normalizeSnapshot({
        routes: [...list(history?.routes), ...list(trace?.routes)], rows: list(ledger?.rows),
        sourceKind: Array.isArray(trace?.routes) ? 'trace' : 'usage',
      });
      snapshot.source = { label: 'Magpie web', detail: 'Recent 24-hour records · up to 500 requests · totals below come from the usage API' };
      snapshot.routeWarnings = warnings;
      return snapshot;
    });
  }

  async dashboard(period = 'today', zone = '') {
    if (!PERIODS.includes(period)) throw new SourceError('Unknown usage period');
    if (zone.length > 100 || !/^[A-Za-z0-9_+/:.-]*$/.test(zone)) throw new SourceError('Invalid time zone');
    if (!this.configured) throw new SourceError('Set MAGPIE_WEB_URL and MAGPIE_WEB_KEY in the bridge .env');
    const query = `period=${period}${zone ? `&tz=${encodeURIComponent(zone)}` : ''}`;
    const [routeResult, usageResult, groupResult] = await Promise.allSettled([
      this.snapshot(),
      this.cached(`usage:${query}`, 5000, async () => usageSummary(await this.read(`${this.web ? '/api' : '/v1/magpie'}/usage?${query}`), period)),
      this.web ? this.cached('groups', 30000, async () => routeGroups(await this.read('/api/groups'))) : Promise.resolve(null),
    ]);
    if ([routeResult, usageResult, groupResult].every(result => result.status === 'rejected' || result.value == null)) {
      throw usageResult.reason || routeResult.reason;
    }
    const routes = fulfilled(routeResult);
    const warnings = [...(routes?.routeWarnings || [])];
    if (!routes) warnings.push('Recent requests could not be loaded. Refresh to retry.');
    if (usageResult.status === 'rejected') warnings.push('Usage totals could not be loaded. Refresh to retry.');
    if (groupResult.status === 'rejected') warnings.push('Route configuration could not be loaded. Refresh to retry.');
    if (!this.web) warnings.push('Connect to the Magpie web service to see configured route groups.');
    return {
      ...(routes || { mode: 'live', requests: [], groups: [], providers: [] }),
      connection: warnings.length ? 'partial' : 'connected', updatedAt: new Date().toISOString(),
      service: this.service, period, zone: zone || 'Service time zone',
      usage: fulfilled(usageResult), configuredGroups: fulfilled(groupResult), warnings,
    };
  }
}
