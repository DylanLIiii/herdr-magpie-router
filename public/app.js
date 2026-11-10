const $ = id => document.getElementById(id);
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const params = new URLSearchParams(location.search);
const state = {
  mode: 'live', snapshot: null, range: '1h',
  view: ['requests', 'groups'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'overview',
  search: '', status: 'all', selected: null, detailOpen: false,
  loading: false, fetchError: '', lastReceived: null
};
const durations = {'15m': 900000, '1h': 3600000, '24h': 86400000};
const statusLabels = {success: '成功', error: '失败', pending: '处理中'};
const viewLabels = {overview: '路由概览', requests: '请求记录', groups: '路由分组'};
const number = value => typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('zh-CN') : '—';
const duration = value => typeof value === 'number' && Number.isFinite(value) ? (value >= 1000 ? `${(value / 1000).toFixed(2)} s` : `${Math.round(value)} ms`) : '—';
const shortTime = value => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleTimeString('zh-CN', {hour12: false});
};
const statusTag = status => `<span class="status ${status === 'error' ? 'error' : status === 'pending' ? 'pending' : ''}">${escape(statusLabels[status] || '未知')}</span>`;
const requests = () => Array.isArray(state.snapshot?.requests) ? state.snapshot.requests : [];
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

function renderMetrics() {
  const data = inRange();
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
  $('nav-count').textContent = number(requests().length);
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

function renderDiagram(data) {
  const selected = data.find(request => request.id === state.selected);
  if (!selected) {
    $('route-caption').textContent = '选择一条请求，追踪它的完整路径';
    $('route-diagram').innerHTML = '<div class="empty-state"><strong>暂无可展示的路由</strong><p>有请求记录后，分组、模型与提供商会在这里连接。</p></div>';
    $('graph-note').textContent = '路径来自当前请求记录';
    return;
  }
  $('route-caption').textContent = `${groupName(selected.group)} · ${selected.id}`;
  $('graph-note').textContent = selected.fallback ? '此请求发生了回退，虚线显示失败尝试' : selected.fallback === null ? '数据源未提供尝试记录，回退情况未知' : '已突出当前选中请求';
  // Keep the selected route and its failed attempts visible; other requests provide context.
  const attempts = (Array.isArray(selected.attempts) ? selected.attempts : []).filter(attempt => attempt.status === 'error');
  const context = [selected, ...data.filter(request => request.id !== selected.id)];
  const unique = values => [...new Set(values.filter(Boolean))];
  const groupIds = unique(context.map(request => request.group || '未分组')).slice(0, 4);
  const modelIds = unique([selected.model || selected.requestedModel || '未知模型', ...attempts.map(attempt => attempt.model), ...context.map(request => request.model || request.requestedModel)]).slice(0, 4);
  const providerIds = unique([selected.provider || '未知提供商', ...attempts.map(attempt => attempt.provider), ...context.map(request => request.provider)]).slice(0, 4);
  const cols = [groupIds, modelIds, providerIds];
  const positions = cols.map(list => new Map(list.map((id, index) => [id, 79 + index * (list.length > 3 ? 48 : 58) + (3 - Math.min(list.length, 3)) * 20])));
  const x = [24, 326, 630], width = 216;
  const selectedIds = [selected.group || '未分组', selected.model || selected.requestedModel || '未知模型', selected.provider || '未知提供商'];
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
  const failed = attempts.map(attempt => curve(0, selectedIds[0], attempt.model, 'attempt') + curve(1, attempt.model, attempt.provider, 'attempt')).join('');
  const active = curve(0, selectedIds[0], selectedIds[1], 'active') + curve(1, selectedIds[1], selectedIds[2], 'active');
  const truncate = (value, limit = 25) => String(value).length > limit ? String(value).slice(0, limit - 1) + '…' : value;
  const nodes = cols.map((list, col) => list.map(id => {
    const isSelected = selectedIds[col] === id;
    const label = col === 0 ? groupName(id) : col === 2 ? providerName(id) : id;
    return `<g class="graph-node ${col === 0 ? 'group' : ''} ${isSelected ? 'active' : 'dim'}"><title>${escape(label)}</title><rect x="${x[col]}" y="${positions[col].get(id) - 20}" width="${width}" height="40" rx="5"/><circle cx="${x[col] + 16}" cy="${positions[col].get(id)}" r="3"/><text x="${x[col] + 29}" y="${positions[col].get(id) + 4}">${escape(truncate(label))}</text></g>`;
  }).join('')).join('');
  const compact = `<div class="compact-route" aria-label="当前请求的完整路径">${['请求分组', '实际模型', '提供商'].map((label, index) => `<div class="compact-step"><span>${label}</span><strong>${escape(index === 0 ? groupName(selectedIds[0]) : index === 2 ? providerName(selectedIds[2]) : selectedIds[1])}</strong></div>`).join('')}<div class="compact-result">${statusTag(selected.status)}<span>${duration(selected.durationMs)}</span>${selected.fallback ? '<span class="fallback-label">发生回退 · 选择请求查看尝试</span>' : ''}</div></div>`;
  $('route-diagram').innerHTML = `<svg viewBox="0 0 870 280" role="img" aria-label="${escape(`当前请求路径：${groupName(selectedIds[0])} → ${selectedIds[1]} → ${providerName(selectedIds[2])}${selected.fallback ? '，含回退尝试' : ''}`)}"><text class="graph-column-label" x="24" y="29">请求分组</text><text class="graph-column-label" x="326" y="29">实际模型</text><text class="graph-column-label" x="630" y="29">提供商</text>${background}${failed}${active}${nodes}</svg>${compact}`;
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
  renderSource(); renderMetrics(); renderRequests(); renderProviders(); renderGroups(); renderView();
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
    state.lastReceived = Date.now();
  } catch (error) {
    if (generation !== fetchGeneration) return;
    state.fetchError = error.name === 'AbortError' ? '读取数据超时。' : `无法读取数据：${error.message || '网络连接失败'}。`;
  } finally {
    clearTimeout(timeout);
    if (generation === fetchGeneration) { state.loading = false; render(); }
  }
}

document.body.classList.toggle('embed', params.get('embed') === '1');
$('refresh').addEventListener('click', fetchSnapshot);
window.addEventListener('hashchange', () => {
  state.view = ['requests', 'groups'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'overview';
  renderView();
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
document.addEventListener('visibilitychange', () => { if (!document.hidden) fetchSnapshot(); });
