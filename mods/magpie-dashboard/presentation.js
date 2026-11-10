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
