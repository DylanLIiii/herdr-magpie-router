import { homedir } from 'node:os';
import { join } from 'node:path';
import { createReader, SourceError } from './upstream.js';
import { readHistory } from './history.js';
import { normalizeSnapshot } from './normalize.js';

export class MagpieSource {
  constructor({ env = process.env, fetchImpl = fetch, historyReader = readHistory } = {}) {
    this.configured = Boolean(env.MAGPIE_URL);
    this.historyDirectory = env.MAGPIE_HISTORY_DIR === 'off' ? '' : env.MAGPIE_HISTORY_DIR || join(env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'magpie', 'routing');
    this.historyReader = historyReader;
    this.read = null;
    this.traceUnsupportedUntil = 0;
    this.cached = null;
    this.inflight = null;
    if (this.configured) this.read = createReader({ baseUrl: env.MAGPIE_URL, fetchImpl, headers: env.MAGPIE_API_KEY ? { Authorization: `Bearer ${env.MAGPIE_API_KEY}` } : {} });
  }

  async snapshot() {
    if (this.cached && Date.now() - this.cached.createdAt < 2500) return this.cached.value;
    if (this.inflight) return this.inflight;
    this.inflight = this.load().then(value => { this.cached = { value, createdAt: Date.now() }; return value; }).finally(() => { this.inflight = null; });
    return this.inflight;
  }

  async load() {
    if (!this.read) throw new SourceError('尚未配置 MAGPIE_URL');
    const [trace, usage, history] = await Promise.allSettled([
      this.traceUnsupportedUntil > Date.now() ? Promise.resolve(null) : this.read('/v1/magpie/trace?after=0'),
      this.read('/v1/magpie/usage/requests?limit=500&period=all'),
      this.historyReader(this.historyDirectory),
    ]);
    if (trace.status === 'rejected' && trace.reason.status === 404) this.traceUnsupportedUntil = Date.now() + 60000;
    const traceData = trace.status === 'fulfilled' ? trace.value : null;
    const usageData = usage.status === 'fulfilled' ? usage.value : null;
    const historyData = history.status === 'fulfilled' ? history.value : { routes: [], available: false };
    const hasTrace = Array.isArray(traceData?.routes);
    const hasUsage = Array.isArray(usageData?.rows);
    // Require an answering service, even when older records are available on disk.
    if (!hasTrace && !hasUsage) throw (usage.status === 'rejected' ? usage.reason : trace.status === 'rejected' ? trace.reason : new SourceError('Magpie 接口数据格式不兼容'));
    const byId = new Map();
    for (const route of [...historyData.routes, ...(hasTrace ? traceData.routes : [])]) if (route?.id != null) byId.set(String(route.id), route);
    return normalizeSnapshot({
      routes: [...byId.values()], rows: hasUsage ? usageData.rows : [],
      sourceKind: hasTrace ? 'trace' : historyData.available ? 'history' : 'usage',
      warning: !hasUsage ? 'usage 暂不可用，部分用量未知' : historyData.truncated ? '历史文件仅取末尾，统计可能不完整' : undefined,
    });
  }
}
