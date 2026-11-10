import { createHash } from 'node:crypto';
import { SourceError } from './upstream.js';

const text = value => typeof value === 'string' ? value.slice(0, 180) : '';
const number = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
const positive = value => number(value) !== null && value >= 0 ? value : null;
const date = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
const list = value => Array.isArray(value) ? value.filter(item => item && typeof item === 'object') : [];

/** Vendor readings only. Account identities, errors, settings and estimated
 * token capacities in Magpie's full cards never cross this boundary. */
export function projectAllowances(value, now = Date.now()) {
  if (!Array.isArray(value)) throw new SourceError('Subscription allowances are unavailable on this Magpie service.');
  const cards = list(value).slice(0, 100).map((card, index) => {
    const windows = list(card.windows).slice(0, 24).map(window => {
      const used = positive(window.used), balance = number(window.balance);
      const remaining = !window.text && !window.unlimited && balance === null && used !== null ? Math.max(0, 100 - Math.min(100, used)) : null;
      const limit = positive(window.limit), amount = positive(window.amount);
      return { name: text(window.name), remaining, balance, unlimited: window.unlimited === true,
        display: window.text ? text(window.display) : '', text: window.text === true,
        amountLeft: limit > 0 ? Math.max(0, limit - (amount ?? 0)) : null, limit: limit > 0 ? limit : null,
        unit: text(window.unit), resetsAt: date(window.resetsAt) || (positive(window.resetSecs) > 0 ? new Date(now + window.resetSecs * 1000).toISOString() : null),
        heldBy: text(window.heldBy), pool: text(window.pool), family: text(window.family) };
    });
    return {
      id: createHash('sha256').update(JSON.stringify([card.provider, card.user, card.from, index])).digest('hex').slice(0, 16),
      provider: text(card.provider), name: text(card.name || card.provider) || 'AI service', plan: text(card.plan),
      windows, balance: card.estimate ? '' : text(card.balance), estimated: Boolean(card.estimate),
      state: card.error ? (windows.length || card.balance ? 'stale' : 'unavailable') : card.readDeferred ? 'deferred' : 'ready',
      readAt: date(card.readAt || card.asOf), held: card.held === true,
    };
  });
  const totals = new Map();
  for (const card of cards) totals.set(card.provider, (totals.get(card.provider) || 0) + 1);
  const seen = new Map();
  for (const card of cards) {
    const index = (seen.get(card.provider) || 0) + 1; seen.set(card.provider, index);
    card.account = totals.get(card.provider) > 1 ? `Account ${index}` : '';
  }
  return { cards, updatedAt: new Date(now).toISOString() };
}
