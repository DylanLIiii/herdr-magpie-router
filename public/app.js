const $ = id => document.getElementById(id);
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const params = new URLSearchParams(location.search);
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let savedMotion = 'on';
try { savedMotion = localStorage.getItem('magpie-route-motion') || 'on'; } catch { /* Private browsing may deny storage. */ }
const state = {
  mode: 'live', snapshot: null, range: '1h',
  view: ['requests', 'groups'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'overview',
  search: '', status: 'all', selected: null, detailOpen: false,
  loading: false, fetchError: '', lastReceived: null, motion: savedMotion !== 'off', reducedMotion: reducedMotion.matches,
  traceError: ''
};
const durations = {'15m': 900000, '1h': 3600000, '24h': 86400000};
const statusLabels = {success: '成功', error: '失败', pending: '处理中', canceled: '已取消'};
const viewLabels = {overview: '路由概览', requests: '请求记录', groups: '路由分组'};
const number = value => typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('zh-CN') : '—';
const duration = value => typeof value === 'number' && Number.isFinite(value) ? (value >= 1000 ? `${(value / 1000).toFixed(2)} s` : `${Math.round(value)} ms`) : '—';
const shortTime = value => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleTimeString('zh-CN', {hour12: false});
};
const statusTag = status => `<span class="status ${status === 'error' || status === 'canceled' ? 'error' : status === 'pending' ? 'pending' : ''}">${escape(statusLabels[status] || '未知')}</span>`;
const requests = () => {
  const snapshot = Array.isArray(state.snapshot?.requests) ? state.snapshot.requests : [];
  if (!webLive?.available) return snapshot;
  const merged = new Map(snapshot.map(request => [request.id, request]));
  for (const route of webLive.routes.values()) {
    const prior = merged.get(route.id);
    merged.set(route.id, {...prior, ...route, timestamp: route.timestamp || prior?.timestamp,
      status: route.status === 'canceled' ? 'canceled' : route.done ? route.status : 'pending'});
  }
  return [...merged.values()];
};
const groups = () => Array.isArray(state.snapshot?.groups) ? state.snapshot.groups : [];
const providers = () => Array.isArray(state.snapshot?.providers) ? state.snapshot.providers : [];

function inRange() {
  const cutoff = Date.now() - durations[state.range];
  return requests().filter(request => new Date(request.timestamp).getTime() >= cutoff)
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
}
function filteredRequests() {
  const query = state.search.trim().toLowerCase();
  return inRange().filter(request => {
    const statusMatches = state.status === 'all' || (state.status === 'fallback' ? request.fallback : request.status === state.status);
    const haystack = [request.id, request.group, request.requestedModel, request.model, request.provider].join(' ').toLowerCase();
    return statusMatches && (!query || haystack.includes(query));
  });
}
function groupName(id) { return groups().find(group => group.id === id)?.name || id || '未分组'; }
function providerName(id) { return providers().find(provider => provider.id === id)?.name || id || '未知提供商'; }
function normalizedRequest(request) {
  return {
    id: request.id ?? null, timestamp: request.timestamp ?? null, group: request.group ?? null,
    requestedModel: request.requestedModel ?? null, model: request.model ?? null,
    provider: request.provider ?? null, status: request.status ?? null,
    durationMs: request.durationMs ?? null, ttftMs: request.ttftMs ?? null,
    inputTokens: request.inputTokens ?? null, outputTokens: request.outputTokens ?? null,
    fallback: request.fallback ?? null, attempts: Array.isArray(request.attempts) ? request.attempts : [],
    ...(request.error ? {error: request.error} : {})
  };
}

// The trace cursor is independent of the five-second aggregate snapshot. Every
// return from a hidden/paused surface starts at zero and catches up only live work.
class TraceClient {
  constructor(onFrame, onError) { this.onFrame = onFrame; this.onError = onError; this.running = false; this.seq = 0; this.epoch = ''; this.controller = null; this.generation = 0; }
  start() {
    if (this.running) return;
    this.running = true; this.seq = 0; this.epoch = '';
    void this.poll(++this.generation);
  }
  stop() {
    this.running = false; this.generation++; this.controller?.abort(); this.controller = null;
    this.seq = 0; this.epoch = '';
  }
  async poll(generation) {
    while (this.running && generation === this.generation) {
      const controller = new AbortController();
      this.controller = controller;
      try {
        const query = new URLSearchParams({mode: 'live', after: String(this.seq), epoch: this.epoch, wait: '1'});
        const response = await fetch(`/api/routing?${query}`, {signal: controller.signal, cache: 'no-store', headers: {Accept: 'application/json'}});
        if (!response.ok) throw new Error(`实时路由返回 ${response.status}`);
        const frame = await response.json();
        if (!Number.isSafeInteger(frame?.seq) || frame.seq < 0 || typeof frame.epoch !== 'string' || !Array.isArray(frame.routes)) throw new Error('实时路由帧无效');
        if (!this.running || controller.signal.aborted || generation !== this.generation) break;
        const reset = Boolean(frame.reset || this.epoch && frame.epoch !== this.epoch || frame.seq < this.seq);
        const unchanged = !reset && frame.seq === this.seq;
        this.seq = frame.seq; this.epoch = frame.epoch;
        if (frame.mine === false) throw new Error('实时路由来自其他连接');
        this.onFrame(frame, reset);
        // A gateway may answer an unchanged cursor immediately. Yield without
        // inventing any trace transitions or keeping a busy loop alive.
        if (unchanged) await new Promise(resolve => setTimeout(resolve, 160));
      } catch (error) {
        if (this.running && !controller.signal.aborted) {
          this.stop(); this.onError(error);
        }
        break;
      } finally {
        if (this.controller === controller) this.controller = null;
      }
    }
  }
}

// Movement durations describe travel only. A held packet waits for either its
// matching attempt's terminal frame or the request's terminal frame.
const phaseLabels = {
  selecting: '选择路线', 'to-group': '进入分组', 'to-model': '发往模型', 'to-provider': '连接提供商',
  held: '等待生成', result: '尝试完成', 'back-provider': '正在回退', 'back-model': '返回分组',
  'await-retry': '等待重选', home: '确认回传', fade: '已完成'
};
const targetModel = (route, index) => route.attempts?.[index]?.model || (!route.attempts?.length && !route.done ? '待选择模型' : route.model || route.requestedModel || '未知模型');
const targetProvider = (route, index) => route.attempts?.[index]?.provider || (!route.attempts?.length && !route.done ? '待选择提供商' : route.provider || '未知提供商');
const stageLabel = (dot, route) => !dot ? '处理中' : dot.phase === 'result' && dot.outcome === 'error' ? '尝试失败'
  : dot.phase === 'result' && dot.outcome === 'canceled' ? '已取消'
  : dot.phase === 'result' && dot.attempt > 0 ? '回退成功'
  : dot.phase === 'to-model' && dot.attempt > 0 ? `重选模型 · 第 ${dot.attempt + 1} 次`
  : phaseLabels[dot.phase];
const easeTravel = progress => {
  let low = 0, high = 1;
  for (let i = 0; i < 10; i++) {
    const t = (low + high) / 2, inverse = 1 - t;
    const x = 3 * .16 * inverse * inverse * t + 3 * .3 * inverse * t * t + t * t * t;
    if (x < progress) low = t; else high = t;
  }
  const t = (low + high) / 2;
  return 1 - Math.pow(1 - t, 3); // cubic-bezier(.16, 1, .3, 1)
};
class WebLiveRouting {
  constructor() { this.routes = new Map(); this.dots = new Map(); this.lanes = []; this.layout = null; this.available = false; this.frame = 0; }
  stop(clear = false) {
    for (const dot of this.dots.values()) clearTimeout(dot.timer);
    this.dots.clear(); this.lanes = []; this.layout = null;
    cancelAnimationFrame(this.frame); this.frame = 0;
    if (clear) { this.routes.clear(); this.available = false; }
    this.refresh();
  }
  ingest(frame, reset) {
    if (reset) this.stop(true);
    this.available = true;
    for (const route of frame.routes) if (route && typeof route.id === 'string') this.routes.set(route.id, route);
    if (Array.isArray(frame.ids)) {
      const ids = new Set(frame.ids);
      for (const [id, route] of this.routes) if (!route.done && !ids.has(id)) this.routes.delete(id);
    }
    for (const [id, dot] of this.dots) if (!this.routes.has(id)) { clearTimeout(dot.timer); this.dots.delete(id); }
    const ordered = [...this.routes.values()].sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
    for (const route of ordered.slice(120)) this.routes.delete(route.id);
    this.fill();
    for (const dot of this.dots.values()) if (!dot.timer) this.advance(dot);
    this.refresh();
  }
  fill() {
    const pending = [...this.routes.values()].filter(route => !route.done).sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
    for (const route of pending) {
      if (this.dots.size >= 4) break;
      if (!this.dots.has(route.id)) {
        const dot = {id: route.id, phase: 'selecting', attempt: 0, outcome: 'pending', started: performance.now(), duration: 170, timer: null};
        this.dots.set(route.id, dot);
        dot.timer = setTimeout(() => { dot.timer = null; this.advance(dot); }, 170);
      }
    }
    const ids = [...new Set([...this.dots.keys(), ...pending.map(route => route.id)])].slice(0, 4);
    const kept = this.lanes.filter(id => ids.includes(id));
    this.lanes = [...kept, ...ids.filter(id => !kept.includes(id))];
  }
  phase(dot, phase, duration = 0) {
    if (this.dots.get(dot.id) !== dot) return;
    clearTimeout(dot.timer);
    dot.phase = phase; dot.started = performance.now(); dot.duration = duration;
    dot.timer = duration ? setTimeout(() => { dot.timer = null; this.advance(dot); }, duration) : null;
    this.refresh();
    if (!duration) this.advance(dot);
  }
  advance(dot) {
    if (this.dots.get(dot.id) !== dot || !motionEnabled() || document.hidden || state.view !== 'overview') return;
    const route = this.routes.get(dot.id);
    if (!route) { this.dots.delete(dot.id); this.fill(); this.refresh(); return; }
    const attempt = route.attempts?.[dot.attempt];
    switch (dot.phase) {
      case 'selecting':
        if (attempt || route.done) this.phase(dot, attempt ? 'to-group' : 'fade', attempt ? 220 : 200);
        break;
      case 'to-group': this.phase(dot, 'to-model', 190); break;
      case 'to-model': this.phase(dot, 'to-provider', 190); break;
      case 'to-provider': this.phase(dot, 'held'); break;
      case 'held':
        if (attempt?.done || route.done) {
          dot.outcome = route.status === 'canceled' ? 'canceled' : attempt?.done ? attempt.status : ['success', 'error'].includes(route.status) ? route.status : 'error';
          this.phase(dot, 'result', 170);
        }
        break;
      case 'result':
        if (dot.outcome !== 'success' || route.done) this.phase(dot, dot.outcome === 'canceled' ? 'fade' : 'back-provider', dot.outcome === 'canceled' ? 200 : 180);
        break;
      case 'back-provider': this.phase(dot, 'back-model', 190); break;
      case 'back-model':
        if (dot.outcome === 'error' && (route.attempts?.[dot.attempt + 1] || !route.done)) this.phase(dot, 'await-retry');
        else this.phase(dot, 'home', 220);
        break;
      case 'await-retry':
        if (route.attempts?.[dot.attempt + 1]) {
          dot.attempt++; dot.outcome = 'pending'; this.phase(dot, 'to-model', 190);
        } else if (route.done) this.phase(dot, 'home', 220);
        break;
      case 'home': this.phase(dot, 'fade', 200); break;
      case 'fade':
        this.dots.delete(dot.id); this.fill(); this.refresh();
        break;
    }
  }
  refresh() {
    if (!$('route-active')) return;
    renderRoutingStatus();
    if (state.view === 'overview') renderDiagram(filteredRequests());
    this.paint();
  }
  paint() {
    cancelAnimationFrame(this.frame); this.frame = 0;
    if (!motionEnabled() || document.hidden || state.view !== 'overview') return;
    const now = performance.now();
    let moving = false;
    for (const [index, id] of this.lanes.entries()) {
      const dot = this.dots.get(id);
      const group = $('route-diagram').querySelector(`[data-flow-index="${index}"]`);
      const packet = $('route-diagram').querySelector(`[data-packet-index="${index}"]`);
      if (!dot || !group || !packet) continue;
      const progress = dot.duration ? Math.min(1, (now - dot.started) / dot.duration) : 1;
      if (dot.duration && progress < 1) moving = true;
      const eased = easeTravel(progress);
      const motion = {
        selecting: ['ingress', 0, 0], 'to-group': ['ingress', 0, eased],
        'to-model': ['model', 0, eased], 'to-provider': ['provider', 0, eased],
        held: ['provider', 1, 1], result: ['provider', 1, 1],
        'back-provider': ['provider', 1, 1 - eased], 'back-model': ['model', 1, 1 - eased],
        'await-retry': ['model', 0, 0], home: ['ingress', 1, 1 - eased],
        fade: [dot.outcome === 'canceled' ? 'provider' : 'ingress', dot.outcome === 'canceled' ? 1 : 0, dot.outcome === 'canceled' ? 1 : 0]
      }[dot.phase];
      const [leg, , position] = motion;
      const path = group.querySelector(`[data-leg="${leg}"]`);
      if (!path) continue;
      const length = path.getTotalLength();
      const point = path.getPointAtLength(length * position);
      for (const circle of packet.querySelectorAll('.live-packet-shell,.live-packet-core,.live-halo')) {
        circle.setAttribute('cx', point.x.toFixed(2)); circle.setAttribute('cy', point.y.toFixed(2));
      }
      const halo = packet.querySelector('.live-halo');
      halo.classList.toggle('pulse', dot.phase === 'held');
      halo.setAttribute('opacity', ['held', 'result'].includes(dot.phase) ? '1' : '0');
      const fade = dot.phase === 'fade' ? 1 - eased : 1;
      packet.querySelector('.live-packet-shell').setAttribute('opacity', String(fade));
      packet.querySelector('.live-packet-core').setAttribute('opacity', String(fade));
      for (const track of group.querySelectorAll('.live-energy')) {
        const trackLength = track.getTotalLength();
        const name = track.dataset.leg;
        let fill = name === 'ingress' ? 0 : name === 'model' ? ['to-provider', 'held', 'result', 'back-provider'].includes(dot.phase) ? 1 : 0 : ['held', 'result'].includes(dot.phase) ? 1 : 0;
        if (name === leg) fill = ['back-provider', 'back-model', 'home'].includes(dot.phase) ? position : ['to-group', 'to-model', 'to-provider'].includes(dot.phase) ? position : fill;
        if (name === 'ingress' && !['selecting', 'to-group', 'fade'].includes(dot.phase)) fill = 1;
        if (name === 'model' && ['back-model', 'await-retry', 'home', 'fade'].includes(dot.phase)) fill = dot.phase === 'back-model' ? position : 0;
        if (dot.phase === 'fade') fill = 0;
        const drawn = Math.max(0, trackLength * fill);
        track.setAttribute('stroke-dasharray', `${drawn.toFixed(2)} ${trackLength.toFixed(2)}`);
        const wake = group.querySelector(`[data-wake="${name}"]`);
        wake.setAttribute('stroke-dasharray', `${Math.min(28, drawn).toFixed(2)} ${trackLength.toFixed(2)}`);
        wake.setAttribute('stroke-dashoffset', String(-Math.max(0, drawn - 28)));
        wake.setAttribute('opacity', drawn && ['to-group', 'to-model', 'to-provider', 'back-provider', 'back-model', 'home'].includes(dot.phase) ? '.52' : '0');
      }
    }
    if (moving) this.frame = requestAnimationFrame(() => this.paint());
  }
}
const motionEnabled = () => state.motion && !state.reducedMotion;
const webLive = new WebLiveRouting();
const traceClient = new TraceClient((frame, reset) => {
  webLive.ingest(frame, reset);
  renderMetrics(); renderRequests();
}, error => {
  state.traceError = error.message;
  webLive.stop(true); renderRequests(); syncTrace();
});
function syncTrace() {
  const connected = state.snapshot?.connection === 'connected' && !state.fetchError;
  const run = connected && motionEnabled() && state.view === 'overview' && !document.hidden && !state.traceError;
  document.body.classList.toggle('motion-on', run);
  if (run) traceClient.start();
  else {
    traceClient.stop(); webLive.stop(true);
    renderRequests();
  }
  renderRoutingStatus();
}
function renderRoutingStatus() {
  const connected = state.snapshot?.connection === 'connected' && !state.fetchError;
  const active = connected ? webLive.available ? [...webLive.routes.values()].filter(route => !route.done).length
    : (state.snapshot?.requests || []).filter(request => request.status === 'pending').length : 0;
  const queued = webLive.available ? Math.max(0, active - [...webLive.dots.values()].filter(dot => !webLive.routes.get(dot.id)?.done).length) : Math.max(0, active - 4);
  $('route-active').lastChild.textContent = ` ${active} 活跃`;
  $('route-active').title = state.traceError ? `实时路由暂不可用：${state.traceError}` : '';
  $('route-queued').textContent = `+${queued} 排队`;
  $('route-queued').hidden = queued === 0;
  $('motion-toggle').setAttribute('aria-pressed', String(state.motion));
  $('motion-toggle').textContent = `动态效果：${state.motion ? '开' : '关'}${state.motion && state.reducedMotion ? ' · 遵循系统减弱动态' : ''}`;
  const ids = webLive.available && connected ? webLive.lanes.filter(id => webLive.routes.get(id) && !webLive.routes.get(id).done) : [];
  $('route-lanes').hidden = ids.length === 0;
  $('route-lanes').innerHTML = ids.map(id => {
    const route = webLive.routes.get(id), dot = webLive.dots.get(id);
    return `<button type="button" class="route-lane ${id === state.selected ? 'selected' : ''}" data-live-index="${webLive.lanes.indexOf(id)}" aria-label="查看请求 ${escape(id)} 的详情"><span class="lane-mark" aria-hidden="true"></span><span class="lane-name">${escape(groupName(route.group))} → ${escape(targetModel(route, dot?.attempt ?? 0))}</span><span class="lane-stage">${escape(stageLabel(dot, route))}</span></button>`;
  }).join('');
}

function renderMetrics() {
  const data = (Array.isArray(state.snapshot?.requests) ? state.snapshot.requests : []).filter(request => new Date(request.timestamp).getTime() >= Date.now() - durations[state.range]);
  $('metric-requests').textContent = number(data.length);
  const completed = data.filter(request => ['success', 'error'].includes(request.status));
  const successes = completed.filter(request => request.status === 'success').length;
  $('metric-success').textContent = completed.length ? `${(successes / completed.length * 100).toFixed(1)}%` : '—';
  const times = data.map(request => request.durationMs).filter(value => typeof value === 'number' && Number.isFinite(value)).sort((a, b) => a - b);
  const middle = Math.floor(times.length / 2);
  const median = times.length ? (times.length % 2 ? times[middle] : (times[middle - 1] + times[middle]) / 2) : null;
  $('metric-duration').textContent = median === null ? '—' : median >= 1000 ? (median / 1000).toFixed(2) : Math.round(median);
  $('metric-duration-unit').textContent = median === null ? '' : median >= 1000 ? 's' : 'ms';
  const unknownFallback = data.some(request => request.fallback === null);
  const fallbackCount = data.filter(request => request.fallback).length;
  $('metric-fallback').textContent = unknownFallback ? (fallbackCount ? `${number(fallbackCount)}+` : '—') : number(fallbackCount);
  $('metric-fallback').title = unknownFallback ? '部分请求没有尝试记录，回退次数未知' : '在当前时间窗口中有失败后继续尝试的请求';
  $('nav-count').textContent = number(state.snapshot?.requests?.length);
}

function renderSource() {
  const snapshot = state.snapshot;
  $('source-badge').textContent = '实时数据';
  $('source-badge').classList.add('live');
  $('source-detail').textContent = snapshot?.source?.detail || '通过本地桥接读取 Magpie';
  $('source-name').textContent = snapshot?.source?.label || '本地路由观察';
  $('source-detail').title = snapshot?.source?.detail || '';
  const connection = state.fetchError ? 'disconnected' : snapshot?.connection;
  const labels = {connected: 'Magpie 已连接', disconnected: '连接已断开', unconfigured: '尚未配置连接'};
  $('connection-label').textContent = labels[connection] || '正在连接';
  $('connection-dot').className = connection || '';
  $('updated-label').textContent = snapshot?.updatedAt ? `更新于 ${shortTime(snapshot.updatedAt)}` : state.loading ? '正在读取数据…' : '尚无更新';
  const message = state.fetchError
    ? `${state.snapshot ? '数据可能已过期。' : ''}${state.fetchError} 点击右上角刷新重试。`
    : snapshot?.error ? `数据源暂不可用：${snapshot.error}`
    : snapshot?.connection === 'unconfigured' ? '尚未配置 Magpie 连接。请在本地桥接服务中配置数据源。'
    : snapshot?.connection === 'disconnected' ? '与数据源的连接已断开。请检查本地桥接服务，然后刷新重试。' : '';
  $('notice').hidden = !message;
  $('notice').textContent = message;
  $('refresh').disabled = state.loading;
  $('refresh').classList.toggle('loading', state.loading);
  $('refresh').setAttribute('aria-busy', String(state.loading));
  $('table-footnote').textContent = state.loading ? '正在更新…' : '每 5 秒自动更新';
}

function renderRequests() {
  const focusedRow = document.activeElement?.closest?.('[data-request-index]');
  const focusedId = focusedRow ? filteredRequests()[Number(focusedRow.dataset.requestIndex)]?.id : null;
  const data = filteredRequests();
  if (!data.some(request => request.id === state.selected)) {
    state.selected = data[0]?.id || null;
    state.detailOpen = false;
  }
  $('request-count').textContent = `${number(data.length)} 条`;
  $('export').disabled = !data.length;
  $('request-rows').innerHTML = data.map((request, index) => `<tr data-request-index="${index}" class="${request.id === state.selected ? 'selected' : ''}">
    <td><button class="request-select" data-select-index="${index}" aria-expanded="${request.id === state.selected && state.detailOpen}" aria-controls="request-detail" aria-label="查看请求 ${escape(request.id)} 的详情"><strong title="${escape(request.model)}">${escape(request.model || request.requestedModel || '—')}</strong><span>${escape(groupName(request.group))}${request.fallback ? '<span class="fallback-label">回退</span>' : ''}</span></button></td>
    <td class="mono">${escape(providerName(request.provider))}</td><td>${statusTag(request.status)}</td><td class="numeric mono">${duration(request.durationMs)}</td><td class="numeric mono muted">${shortTime(request.timestamp)}</td></tr>`).join('');
  $('requests-empty').hidden = data.length > 0;
  const emptyTitle = $('requests-empty').querySelector('strong');
  const emptyCopy = $('requests-empty').querySelector('p');
  emptyTitle.textContent = requests().length ? '没有匹配的请求' : '暂时没有请求记录';
  emptyCopy.textContent = requests().length ? '试试其他时间范围，或清除筛选条件。' : state.mode === 'live' ? '连接数据源后，新的请求会自动出现在这里。' : '等待数据源提供演示请求，或点击刷新重试。';
  $('clear-filters').hidden = !requests().length;
  renderDetail();
  renderDiagram(data);
  if (focusedId) {
    const index = data.findIndex(request => request.id === focusedId);
    if (index >= 0) $('request-rows').querySelector(`[data-select-index="${index}"]`)?.focus({preventScroll: true});
  }
}

function renderDetail() {
  const request = requests().find(item => item.id === state.selected);
  $('request-detail').hidden = !request || !state.detailOpen;
  if (!request || !state.detailOpen) return;
  const attempts = Array.isArray(request.attempts) ? request.attempts : [];
  $('request-detail').innerHTML = `<div class="detail-heading"><h3>请求详情</h3><button class="text-button" id="close-detail">收起详情</button></div><p class="detail-id">${escape(request.id)} · ${escape(request.timestamp || '—')}</p>
    <dl class="detail-metrics"><div><dt>响应耗时</dt><dd>${duration(request.durationMs)}</dd></div><div><dt>首字延迟</dt><dd>${duration(request.ttftMs)}</dd></div><div><dt>输入 tokens</dt><dd>${number(request.inputTokens)}</dd></div><div><dt>输出 tokens</dt><dd>${number(request.outputTokens)}</dd></div></dl>
    <p class="attempt-title">请求模型：<span class="mono">${escape(request.requestedModel || '—')}</span></p><h4 class="attempt-title">路由尝试 · ${attempts.length}</h4>
    ${attempts.length ? attempts.map((attempt, index) => `<div class="attempt"><span class="muted mono">${index + 1}</span><span class="attempt-route">${escape(attempt.model || '—')} → ${escape(providerName(attempt.provider))}</span>${statusTag(attempt.status)}<span class="mono">${duration(attempt.durationMs)}</span></div>${attempt.error ? `<p class="error-message">${escape(attempt.error)}</p>` : ''}`).join('') : '<p class="muted">数据源未提供尝试记录。</p>'}
    ${request.error ? `<p class="error-message">${escape(request.error)}</p>` : ''}`;
  $('close-detail').addEventListener('click', () => {
    state.detailOpen = false;
    renderDetail();
    $('request-rows').querySelector('tr.selected button')?.focus();
    $('request-rows').querySelector('tr.selected button')?.setAttribute('aria-expanded', 'false');
  });
}

function renderFlows(positions) {
  if (!motionEnabled() || state.view !== 'overview') return {rails: '', packets: ''};
  let rails = '', packets = '';
  webLive.lanes.forEach((id, index) => {
    const route = webLive.routes.get(id), dot = webLive.dots.get(id);
    if (!route || !dot) return;
    const yGroup = positions[0].get(route.group || '未分组');
    const yModel = positions[1].get(targetModel(route, dot.attempt));
    const yProvider = positions[2].get(targetProvider(route, dot.attempt));
    if ([yGroup, yModel, yProvider].some(value => value === undefined)) return;
    const paths = {
      ingress: `M8,${yGroup} L240,${yGroup}`,
      model: `M240,${yGroup} C285,${yGroup} 281,${yModel} 326,${yModel} L542,${yModel}`,
      provider: `M542,${yModel} C587,${yModel} 585,${yProvider} 630,${yProvider} L646,${yProvider}`
    };
    const failed = dot.outcome === 'error' || dot.phase === 'await-retry';
    const tone = failed || (route.attempts || []).slice(0, dot.attempt).some(item => item.status === 'error') ? 'recovered' : '';
    rails += `<g class="live-flow ${tone}" data-flow-index="${index}" aria-hidden="true">${Object.entries(paths).map(([name, d]) => `<path class="live-energy" data-leg="${name}" d="${d}"/><path class="live-wake" data-wake="${name}" d="${d}"/>`).join('')}</g>`;
    packets += `<g class="live-packet ${tone}" data-packet-index="${index}" aria-hidden="true"><circle class="live-halo" cx="8" cy="${yGroup}" r="10" opacity="0"/><circle class="live-packet-shell" cx="8" cy="${yGroup}" r="7"/><circle class="live-packet-core" cx="8" cy="${yGroup}" r="2.5"/></g>`;
  });
  return {rails, packets};
}

// Once a packet is in flight, retain every visible node's slot. New traffic
// takes a free slot instead of moving the paths beneath existing packets.
function diagramPositions(cols) {
  const slots = [56, 83, 110, 137, 164, 191, 218, 245];
  const spreads = [[137], [110, 191], [83, 137, 218], [83, 137, 191, 245],
    [56, 110, 164, 218, 245], [56, 83, 110, 164, 218, 245],
    [56, 83, 110, 164, 191, 218, 245], slots];
  if (!webLive.dots.size) {
    webLive.layout = null;
    return cols.map(list => new Map(list.map((id, index) => [id, (list.length > 4 ? 64 : 79 + (3 - Math.min(list.length, 3)) * 20) + index * (list.length > 4 ? 38 : list.length > 3 ? 48 : 58)])));
  }
  if (!webLive.layout) webLive.layout = cols.map(() => new Map());
  return cols.map((list, column) => {
    const positions = webLive.layout[column];
    for (const id of positions.keys()) if (!list.includes(id)) positions.delete(id);
    if (!positions.size) list.forEach((id, index) => positions.set(id, spreads[list.length - 1][index]));
    else list.forEach((id, index) => {
      if (positions.has(id)) return;
      const desired = slots[Math.round(index * (slots.length - 1) / Math.max(1, list.length - 1))];
      const free = slots.filter(y => ![...positions.values()].includes(y));
      positions.set(id, free.sort((a, b) => Math.abs(a - desired) - Math.abs(b - desired))[0]);
    });
    return positions;
  });
}

function renderDiagram(data) {
  const selected = data.find(request => request.id === state.selected);
  if (!selected) {
    $('route-caption').textContent = '选择一条请求，追踪它的完整路径';
    $('route-diagram').innerHTML = '<div class="empty-state"><strong>暂无可展示的路由</strong><p>有请求记录后，分组、模型与提供商会在这里连接。</p></div>';
    $('graph-note').textContent = '路径来自当前请求记录';
    return;
  }
  $('route-caption').textContent = `${groupName(selected.group)} · ${selected.id}`;
  const liveRoutes = webLive.lanes.map(id => webLive.routes.get(id)).filter(Boolean);
  const failedAttempts = [selected, ...liveRoutes.filter(route => route.id !== selected.id)].flatMap(route =>
    (Array.isArray(route.attempts) ? route.attempts : []).filter(attempt => attempt.status === 'error')
      .map(attempt => ({group: route.group || '未分组', attempt})));
  $('graph-note').textContent = selected.fallback ? '此请求发生了回退，虚线显示失败尝试'
    : failedAttempts.length ? '活跃车道含回退尝试，虚线显示失败分支'
    : selected.fallback === null ? '数据源未提供尝试记录，回退情况未知' : '已突出当前选中请求';
  // Active destinations and their failed branches take priority over history.
  const context = [selected, ...liveRoutes.filter(route => route.id !== selected.id), ...data.filter(request => request.id !== selected.id && !liveRoutes.some(route => route.id === request.id))];
  const unique = values => [...new Set(values.filter(Boolean))];
  const groupIds = unique([...liveRoutes.map(route => route.group || '未分组'), selected.group || '未分组', ...context.map(request => request.group || '未分组')]).slice(0, 6);
  const modelIds = unique([...liveRoutes.map(route => targetModel(route, webLive.dots.get(route.id)?.attempt ?? 0)), targetModel(selected, Math.max(0, (selected.attempts?.length || 1) - 1)), ...failedAttempts.map(({attempt}) => attempt.model), ...context.map(request => request.model || request.requestedModel)]).slice(0, 8);
  const providerIds = unique([...liveRoutes.map(route => targetProvider(route, webLive.dots.get(route.id)?.attempt ?? 0)), targetProvider(selected, Math.max(0, (selected.attempts?.length || 1) - 1)), ...failedAttempts.map(({attempt}) => attempt.provider), ...context.map(request => request.provider)]).slice(0, 8);
  const cols = [groupIds, modelIds, providerIds];
  const positions = diagramPositions(cols);
  const heights = positions.map(column => {
    const ys = [...column.values()].sort((a, b) => a - b);
    return Math.min(40, ys.length < 2 ? 40 : Math.min(...ys.slice(1).map((y, index) => y - ys[index])) - 4);
  });
  const x = [24, 326, 630], width = 216;
  const selectedIds = [selected.group || '未分组', targetModel(selected, Math.max(0, (selected.attempts?.length || 1) - 1)), targetProvider(selected, Math.max(0, (selected.attempts?.length || 1) - 1))];
  const curve = (fromCol, from, to, className) => {
    const y1 = positions[fromCol].get(from), y2 = positions[fromCol + 1].get(to);
    if (y1 === undefined || y2 === undefined) return '';
    const start = x[fromCol] + width, end = x[fromCol + 1];
    return `<path class="route-path ${className}" d="M${start},${y1} C${start + 45},${y1} ${end - 45},${y2} ${end},${y2}"/>`;
  };
  const paths = new Set();
  let background = '';
  for (const request of context.slice(1)) {
    const ids = [request.group || '未分组', request.model || request.requestedModel, request.provider];
    for (let col = 0; col < 2; col++) {
      const key = `${col}:${ids[col]}:${ids[col + 1]}`;
      if (!paths.has(key) && !(ids[col] === selectedIds[col] && ids[col + 1] === selectedIds[col + 1])) {
        paths.add(key); background += curve(col, ids[col], ids[col + 1], 'dim');
      }
    }
  }
  const visibleFailures = failedAttempts.filter(({group, attempt}) => positions[0].has(group) && positions[1].has(attempt.model) && positions[2].has(attempt.provider));
  const omittedFailures = failedAttempts.filter(item => !visibleFailures.includes(item));
  const failed = [...new Set(visibleFailures.map(({group, attempt}) => curve(0, group, attempt.model, 'attempt') + curve(1, attempt.model, attempt.provider, 'attempt')))].join('');
  if (omittedFailures.length) $('graph-note').textContent += `；${omittedFailures.length} 条回退轨迹列于下方`;
  const active = selected.attempts?.at(-1)?.status === 'error' ? '' : curve(0, selectedIds[0], selectedIds[1], 'active') + curve(1, selectedIds[1], selectedIds[2], 'active');
  const truncate = (value, limit = 25) => String(value).length > limit ? String(value).slice(0, limit - 1) + '…' : value;
  const nodes = cols.map((list, col) => list.map(id => {
    const isSelected = selectedIds[col] === id;
    const isLive = liveRoutes.some(route => col === 0 ? (route.group || '未分组') === id : col === 1 ? targetModel(route, webLive.dots.get(route.id)?.attempt ?? 0) === id : targetProvider(route, webLive.dots.get(route.id)?.attempt ?? 0) === id);
    const label = col === 0 ? groupName(id) : col === 2 ? providerName(id) : id;
    return `<g class="graph-node ${col === 0 ? 'group' : ''} ${isSelected || isLive ? 'active' : 'dim'}"><title>${escape(label)}</title><rect x="${x[col]}" y="${positions[col].get(id) - heights[col] / 2}" width="${width}" height="${heights[col]}" rx="5"/><circle cx="${x[col] + 16}" cy="${positions[col].get(id)}" r="3"/><text x="${x[col] + 29}" y="${positions[col].get(id) + 4}">${escape(truncate(label))}</text></g>`;
  }).join('')).join('');
  const selectedDot = webLive.dots.get(selected.id);
  const stageIndex = selectedDot ? ['selecting', 'to-group', 'await-retry', 'home', 'fade'].includes(selectedDot.phase) ? 0 : ['to-model', 'back-model'].includes(selectedDot.phase) ? 1 : 2 : -1;
  const stageText = selectedDot ? stageLabel(selectedDot, selected) : selected.status === 'pending' ? selected.attempts?.length ? '等待生成' : '选择路线' : '';
  const compact = `<div class="compact-route" aria-label="当前请求的完整路径">${['请求分组', '实际模型', '提供商'].map((label, index) => `<div class="compact-step ${index === stageIndex || stageIndex < 0 && selected.status === 'pending' && index === (selected.attempts?.length ? 2 : 0) ? 'current' : ''} ${stageIndex > index ? 'passed' : ''}"><span>${label}</span><strong>${escape(index === 0 ? groupName(selectedIds[0]) : index === 2 ? providerName(selectedIds[2]) : selectedIds[1])}</strong>${index === stageIndex || stageIndex < 0 && selected.status === 'pending' && index === (selected.attempts?.length ? 2 : 0) ? `<small class="compact-stage">${escape(stageText)}</small>` : ''}</div>`).join('')}<div class="compact-result">${statusTag(selected.status)}<span>${duration(selected.durationMs)}</span>${selected.fallback ? '<span class="fallback-label">发生回退 · 选择请求查看尝试</span>' : ''}</div></div>`;
  const flows = renderFlows(positions);
  const archived = omittedFailures.length ? `<div class="route-fallback-archive" role="list" aria-label="其余失败尝试"><strong>其余回退轨迹 · ${omittedFailures.length}</strong>${omittedFailures.map(({group, attempt}) => `<div role="listitem"><span class="archive-dash" aria-hidden="true"></span>${escape(groupName(group))} → ${escape(attempt.model || '未知模型')} → ${escape(providerName(attempt.provider))}</div>`).join('')}</div>` : '';
  $('route-diagram').innerHTML = `<svg viewBox="0 0 870 280" role="img" aria-label="${escape(`当前请求路径：${groupName(selectedIds[0])} → ${selectedIds[1]} → ${providerName(selectedIds[2])}${selected.fallback ? '，含回退尝试' : ''}`)}"><text class="graph-column-label" x="24" y="29">请求分组</text><text class="graph-column-label" x="326" y="29">实际模型</text><text class="graph-column-label" x="630" y="29">提供商</text>${background}${failed}${active}${flows.rails}${nodes}${flows.packets}</svg>${archived}${compact}`;
  if (flows.packets) webLive.paint();
}

function renderProviders() {
  const data = providers();
  $('provider-count').textContent = `${data.length} 个`;
  $('providers-list').innerHTML = data.length ? data.map(provider => {
    const health = ['healthy', 'degraded'].includes(provider.status) ? provider.status : 'unknown';
    const healthLabel = {healthy: '健康', degraded: '异常', unknown: '未知'}[health];
    return `<div class="provider-item"><div class="provider-title"><span class="provider-monogram" aria-hidden="true">${escape((provider.name || provider.id || '?').slice(0, 1).toUpperCase())}</span><span class="provider-name" title="${escape(provider.id)}">${escape(provider.name || provider.id)}</span><span class="provider-health ${health}" role="img" aria-label="${healthLabel}" title="${healthLabel}"></span></div><div class="provider-meta"><span><span class="mono">${number(provider.requests)}</span> 次请求</span><span>${provider.errors ? `${number(provider.errors)} 次失败` : provider.errors === 0 ? '无失败记录' : '失败数未知'}</span></div></div>`;
  }).join('') : '<div class="empty-state">暂无提供商数据</div>';
}
function renderGroups() {
  const data = groups();
  $('groups-count').textContent = `${data.length} 个分组`;
  $('groups-list').innerHTML = data.length ? data.map(group => `<article class="group-item"><div class="group-info"><h3>${escape(group.name || group.id)}</h3><p class="mono">${escape(group.id)}</p><p>策略：${escape(group.strategy || '未提供')}</p>${group.enabled === false ? '<span class="group-disabled">已停用</span>' : ''}</div><div class="candidate-list">${Array.isArray(group.candidates) && group.candidates.length ? group.candidates.map(candidate => `<div class="candidate"><span class="candidate-model">${escape(candidate.model || '—')}<br><small>${escape(providerName(candidate.provider))}</small></span><small>${typeof candidate.weight === 'number' ? `权重 ${number(candidate.weight)}` : '权重未提供'}</small></div>`).join('') : '<p class="muted">暂无候选模型</p>'}</div></article>`).join('') : '<div class="empty-state"><strong>数据源尚未提供路由分组</strong><p>请求中的实际路由仍可在概览中查看。</p></div>';
}
function renderView() {
  document.body.classList.toggle('view-requests', state.view === 'requests');
  $('route-section').hidden = state.view !== 'overview';
  $('groups-section').hidden = state.view !== 'groups';
  $('lower-layout').hidden = state.view === 'groups';
  $('providers-section').hidden = state.view !== 'overview';
  $('breadcrumb-view').textContent = viewLabels[state.view];
  $('page-title').textContent = {overview: '看见每一次路由。', requests: '每一次请求，有迹可循。', groups: '让模型各得其所。'}[state.view];
  $('page-subtitle').textContent = {overview: '从请求到模型，再到提供商。让每一次选择清晰可循。', requests: '检查响应、回退与失败，沿着实际路径找到答案。', groups: '查看路由策略与候选模型，理解每个分组的选择。'}[state.view];
  document.querySelectorAll('[data-view]').forEach(link => {
    if (link.dataset.view === state.view) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
}
function render() {
  renderSource(); renderMetrics(); renderRequests(); renderProviders(); renderGroups(); renderView(); renderRoutingStatus();
}

let controller;
let fetchGeneration = 0;
async function fetchSnapshot() {
  if (state.loading) return;
  const generation = ++fetchGeneration;
  const requestedMode = state.mode;
  state.loading = true;
  controller = new AbortController();
  const timeout = setTimeout(() => controller?.abort(), 12000);
  renderSource();
  try {
    const response = await fetch(`/api/snapshot?mode=${requestedMode}`, {signal: controller.signal, cache: 'no-store', headers: {Accept: 'application/json'}});
    const snapshot = await response.json();
    if (!snapshot || !Array.isArray(snapshot.requests) || !Array.isArray(snapshot.groups) || !Array.isArray(snapshot.providers)) throw new Error('数据源返回了无法识别的数据');
    if (!response.ok && snapshot.connection === 'connected') throw new Error(`本地桥接服务返回 ${response.status}`);
    if (generation !== fetchGeneration) return;
    state.snapshot = snapshot;
    state.fetchError = '';
    state.traceError = '';
    state.lastReceived = Date.now();
  } catch (error) {
    if (generation !== fetchGeneration) return;
    state.fetchError = error.name === 'AbortError' ? '读取数据超时。' : `无法读取数据：${error.message || '网络连接失败'}。`;
  } finally {
    clearTimeout(timeout);
    if (generation === fetchGeneration) { state.loading = false; render(); syncTrace(); }
  }
}

document.body.classList.toggle('embed', params.get('embed') === '1');
$('refresh').addEventListener('click', fetchSnapshot);
window.addEventListener('hashchange', () => {
  state.view = ['requests', 'groups'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'overview';
  renderView(); syncTrace();
});
$('motion-toggle').addEventListener('click', () => {
  state.motion = !state.motion;
  try { localStorage.setItem('magpie-route-motion', state.motion ? 'on' : 'off'); } catch { /* Motion still works without storage. */ }
  syncTrace();
});
reducedMotion.addEventListener('change', event => {
  state.reducedMotion = event.matches;
  syncTrace();
});
$('route-lanes').addEventListener('click', event => {
  const button = event.target.closest('[data-live-index]');
  if (!button) return;
  const id = webLive.lanes[Number(button.dataset.liveIndex)];
  if (!id || !webLive.routes.has(id)) return;
  state.search = ''; state.status = 'all'; state.range = '24h';
  $('search').value = ''; $('status-filter').value = 'all';
  document.querySelectorAll('[data-range]').forEach(item => item.setAttribute('aria-pressed', String(item.dataset.range === '24h')));
  state.selected = id; state.detailOpen = true;
  renderMetrics(); renderRequests(); renderRoutingStatus();
  $('request-rows').querySelector('tr.selected button')?.focus({preventScroll: true});
});
document.querySelectorAll('[data-range]').forEach(button => button.addEventListener('click', () => {
  state.range = button.dataset.range;
  document.querySelectorAll('[data-range]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
  renderMetrics(); renderRequests();
}));
$('filters').addEventListener('submit', event => event.preventDefault());
$('search').addEventListener('input', event => { state.search = event.target.value; renderRequests(); });
$('status-filter').addEventListener('change', event => { state.status = event.target.value; renderRequests(); });
$('clear-filters').addEventListener('click', () => {
  state.search = ''; state.status = 'all'; state.range = '24h';
  $('search').value = ''; $('status-filter').value = 'all';
  document.querySelectorAll('[data-range]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.range === '24h')));
  renderMetrics(); renderRequests();
});
$('request-rows').addEventListener('click', event => {
  const row = event.target.closest('[data-request-index]');
  if (!row) return;
  const request = filteredRequests()[Number(row.dataset.requestIndex)];
  if (!request) return;
  const hadFocus = Boolean(event.target.closest('button'));
  state.detailOpen = request.id === state.selected ? !state.detailOpen : true;
  state.selected = request.id;
  renderRequests();
  if (hadFocus) $('request-rows').querySelector('tr.selected button')?.focus();
});
$('export').addEventListener('click', () => {
  const content = JSON.stringify({exportedAt: new Date().toISOString(), mode: state.mode, range: state.range, requests: filteredRequests().map(normalizedRequest)}, null, 2);
  const url = URL.createObjectURL(new Blob([content], {type: 'application/json'}));
  const anchor = document.createElement('a'); anchor.href = url;
  anchor.download = `magpie-requests-${state.mode}-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});
renderView(); renderSource(); fetchSnapshot();
setInterval(() => { if (!document.hidden) fetchSnapshot(); }, 5000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) fetchSnapshot(); syncTrace(); });
