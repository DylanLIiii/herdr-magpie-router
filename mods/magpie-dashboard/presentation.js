export const PERIODS = [['today', 'Today'], ['7d', '7 days'], ['30d', '30 days'], ['all', 'All time']];
export const plain = (value, max = 160) => {
  const result = value == null || value === '' ? '—' : String(value);
  return result.length > max ? `${result.slice(0, max - 1)}…` : result;
};
export const count = value => Number.isFinite(value) && value >= 0 ? String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ',') : '—';
export const compact = value => !Number.isFinite(value) || value < 0 ? '—' : value >= 1e6 ? `${(value / 1e6).toFixed(1)}M` : value >= 1e3 ? `${(value / 1e3).toFixed(1)}k` : count(value);
export const money = value => Number.isFinite(value) && value >= 0 ? `$${value.toFixed(2)}` : '—';
export const percent = value => Number.isFinite(value) ? `${Math.round(value * 100)}%` : '—';
export const duration = value => Number.isFinite(value) && value >= 0 ? value < 1000 ? `${Math.round(value)}ms` : `${(value / 1000).toFixed(1)}s` : '—';
export const time = value => {
  if (!value || !Number.isFinite(Date.parse(value))) return '—';
  const date = new Date(value);
  return [date.getHours(), date.getMinutes(), date.getSeconds()].map(part => String(part).padStart(2, '0')).join(':');
};
export const clientName = value => ({ claude: 'Claude Code', 'claude-code': 'Claude Code', codex: 'Codex', cursor: 'Cursor', pi: 'Pi', opencode: 'OpenCode', amp: 'Amp', gemini: 'Gemini CLI' })[value] || value || 'Unknown client';
export function resultInfo(row) {
  if (row.status === 'canceled') return { label: 'Canceled', color: 'muted', effect: 'cancel' };
  if (row.status === 'error') return { label: 'Failed', color: 'blocked', effect: 'error' };
  if (row.status === 'success') return row.fallback ? { label: 'Recovered', color: 'working', effect: 'recovered' } : { label: 'Done', color: 'done', effect: 'success' };
  if (row.status === 'pending') return { label: 'Running', color: 'accent', effect: 'pending' };
  return { label: 'Unknown', color: 'muted', effect: 'unknown' };
}
export const needsAttention = row => row?.status === 'error' || row?.status === 'canceled' || row?.status === 'success' && row?.fallback === true;
export function laneDynamics(route, packet, width = 314) {
  const span = Math.max(180, Number.isFinite(width) ? width : 314);
  const start = 8, middle = Math.round(span * 0.44), end = span - 8;
  const leg1 = Math.max(0, middle - start), leg2 = Math.max(0, end - middle);
  const attempts = Array.isArray(route?.attempts) ? route.attempts : [];
  const attemptIndex = packet ? packet.attempt : Math.max(0, attempts.length - 1);
  const priorError = attempts.slice(0, attemptIndex).some(item => item?.status === 'error');
  const recovered = priorError || Boolean(!packet && route?.fallback);
  const result = resultInfo(route || {});
  if (!packet) {
    const pending = !route?.done && route?.status === 'pending';
    const hasAttempt = attempts.length > 0 || Boolean(route?.model);
    const tone = pending ? (recovered ? 'working' : 'accent') : result.color;
    return {
      start, middle, end, leg1, leg2, tone, recovered, attemptCount: attempts.length, attemptIndex,
      at: pending ? (hasAttempt ? end : start) : end,
      station: pending ? (hasAttempt ? 'model' : 'client') : null,
      stage: pending ? (hasAttempt ? 'Generating' : 'Selecting') : '',
      ingress: { left: start, width: pending && !hasAttempt ? 0 : leg1, opacity: pending ? 0.64 : 0.34 },
      upstream: { left: middle, width: pending && !hasAttempt ? 0 : leg2, opacity: pending ? 0.76 : 0.34 },
      wake: { left: start, width: 0, opacity: 0 },
      halo: { active: pending && hasAttempt, pulse: false, opacity: pending && hasAttempt ? 0.4 : 0 },
    };
  }
  const phase = packet.phase;
  const tone = packet.outcome === 'error' ? 'blocked' : packet.outcome === 'canceled' ? 'muted'
    : priorError ? 'working' : packet.outcome === 'success' ? 'done' : 'accent';
  const at = ['enter', 'selecting', 'home'].includes(phase) ? start
    : ['to-rail', 'return-rail'].includes(phase) ? middle
    : phase === 'fade' && packet.outcome !== 'canceled' ? start : end;
  const station = ['enter', 'selecting', 'home'].includes(phase) ? 'client'
    : ['to-rail', 'return-rail'].includes(phase) ? 'group'
    : phase === 'fade' && packet.outcome !== 'canceled' ? 'client' : 'model';
  const wake1 = Math.min(26, leg1), wake2 = Math.min(30, leg2);
  let ingress = { left: start, width: 0, opacity: 0 }, upstream = { left: middle, width: 0, opacity: 0 };
  let wake = { left: at, width: 0, opacity: 0 }, halo = { active: false, pulse: false, opacity: 0 }, stage = '';
  if (phase === 'enter' || phase === 'selecting') {
    ingress = { left: start, width: 0, opacity: 0.42 };
    stage = priorError ? `Retry ${attemptIndex + 1}` : 'Selecting';
  } else if (phase === 'to-rail') {
    ingress = { left: start, width: leg1, opacity: 0.86 };
    wake = { left: Math.max(start, middle - wake1), width: wake1, opacity: 0.36 };
    stage = priorError ? 'Rerouting' : 'Routing';
  } else if (phase === 'to-model') {
    ingress = { left: start, width: leg1, opacity: 0.68 };
    upstream = { left: middle, width: leg2, opacity: 0.92 };
    wake = { left: Math.max(middle, end - wake2), width: wake2, opacity: 0.38 };
    stage = priorError ? `Try ${attemptIndex + 1}` : 'Dispatching';
  } else if (phase === 'held') {
    ingress = { left: start, width: leg1, opacity: 0.62 };
    upstream = { left: middle, width: leg2, opacity: 0.88 };
    halo = { active: true, pulse: true, opacity: 0.48 };
    stage = 'Generating';
  } else if (phase === 'result') {
    ingress = { left: start, width: leg1, opacity: 0.74 };
    upstream = { left: middle, width: leg2, opacity: 0.96 };
    halo = { active: true, pulse: false, opacity: 0.64 };
    stage = packet.outcome === 'error' ? 'Attempt failed' : packet.outcome === 'canceled' ? 'Canceled' : priorError ? 'Recovered' : 'Complete';
  } else if (phase === 'return-rail') {
    ingress = { left: start, width: leg1, opacity: 0.8 };
    upstream = { left: middle, width: 0, opacity: 0.22 };
    wake = { left: middle, width: wake2, opacity: 0.32 };
    stage = packet.outcome === 'error' ? 'Rerouting' : 'Returning';
  } else if (phase === 'home') {
    ingress = { left: start, width: 0, opacity: 0.24 };
    wake = { left: start, width: wake1, opacity: 0.28 };
    stage = packet.outcome === 'error' ? 'Await retry' : 'Delivered';
  } else if (phase === 'fade') {
    const done = Boolean(route?.done);
    ingress = { left: start, width: done ? leg1 : 0, opacity: done ? 0.34 : 0 };
    upstream = { left: middle, width: done ? leg2 : 0, opacity: done ? 0.34 : 0 };
    stage = packet.outcome === 'canceled' ? 'Canceled' : '';
  }
  return { start, middle, end, leg1, leg2, tone, recovered, attemptCount: attempts.length, attemptIndex, at, station, stage, ingress, upstream, wake, halo };
}
export function resetLabel(value, now = Date.now()) {
  const at = Date.parse(value);
  if (!Number.isFinite(at)) return '';
  const minutes = Math.ceil((at - now) / 60000);
  if (minutes <= 0) return 'Reset due';
  if (minutes < 60) return `Resets in ${minutes}m`;
  if (minutes < 1440) return `Resets in ${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  return `Resets in ${Math.floor(minutes / 1440)}d ${Math.floor(minutes % 1440 / 60)}h`;
}
export function allowanceLabel(window) {
  if (window.unlimited) return 'Unlimited';
  if (Number.isFinite(window.balance)) return `${window.balance.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${window.unit || ''} left`.replace(/ +/g, ' ');
  if (window.text) return window.display || 'No allowance reported';
  if (Number.isFinite(window.remaining)) return `${Math.round(window.remaining)}% left`;
  return 'Not reported';
}
