import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TraceStore, LiveRouting } from '../mods/magpie-dashboard/live-routing.js';
import { projectTrace, readTrace } from '../server/trace.js';
import { cacheHit, tokenTotal, usageBars } from '../mods/magpie-dashboard/usage.js';

const now = '2026-11-09T12:00:00Z';
const route = (id, attempts = [], done = false) => ({ id, timestamp: now, group: 'g', groupRef: 'group/g', done, attempts, status: done ? 'success' : 'pending' });
const attempt = (provider = 'a', done = false, status = 'pending') => ({ index: 0, provider, model: provider, done, status });
const frame = (seq, routes, extra = {}) => ({ seq, epoch: 'one', mine: true, routes, ids: routes.map(route => route.id), ...extra });
function harness() {
  let now = 0;
  const queue = [], tasks = [];
  const cx = { notify() {}, spawn(callback) { const task = callback(cx); tasks.push(task); return task; }, timer: { after(ms, callback) { queue.push({ at: now + ms, callback }); } } };
  return { cx, tasks, async advance(ms) {
    const until = now + ms;
    for (;;) {
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
      queue.sort((a, b) => a.at - b.at);
      if (!queue.length || queue[0].at > until) break;
      const item = queue.shift(); now = item.at; item.callback(cx);
    }
    now = until;
    await Promise.resolve(); await Promise.resolve();
  } };
}

test('trace delta merge uses seq, gateway identity, retained ids and hidden catch-up semantics', () => {
  const store = new TraceStore();
  assert.deepEqual(store.apply(frame(1, [route('old', [], true), route('active')])).play, ['active']);
  assert.deepEqual(store.apply(frame(2, [route('next')], { ids: ['old', 'active', 'next'] })).play, ['next']);
  assert.equal(store.routes.size, 3);
  const caught = store.apply(frame(3, [route('missed', [], true), route('new-active')], { ids: ['old', 'missed', 'new-active'] }), true);
  assert.deepEqual(caught.play, ['new-active']);
  assert.equal(store.routes.has('active'), false);
  assert.equal(store.apply(frame(0, [], { epoch: 'two' })).reset, true);
  assert.equal(store.routes.size, 0);
});

test('native dot waits for upstream done, returns on failure, retries and returns after success', async () => {
  const h = harness(), store = new TraceStore(), live = new LiveRouting();
  live.group = { id: 'g', members: [] };
  let result = store.apply(frame(1, [route('request', [attempt()])]));
  live.ingest(store, result.play, h.cx);
  await h.advance(1500);
  assert.equal(live.dots.get('request').phase, 'held');
  await h.advance(5000);
  assert.equal(live.dots.get('request').phase, 'held', 'animation duration never completes the request');
  result = store.apply(frame(2, [route('request', [attempt('a', true, 'error')])]));
  live.ingest(store, result.play, h.cx);
  await h.advance(1000);
  assert.equal(live.dots.get('request').phase, 'selecting', 'wait at router until next real attempt');
  result = store.apply(frame(3, [route('request', [attempt('a', true, 'error'), attempt('b')])]));
  live.ingest(store, result.play, h.cx);
  await h.advance(1000);
  assert.equal(live.dots.get('request').attempt, 1);
  assert.equal(live.dots.get('request').phase, 'held');
  result = store.apply(frame(4, [route('request', [attempt('a', true, 'error'), attempt('b', true, 'success')], true)]));
  live.ingest(store, result.play, h.cx);
  await h.advance(1500);
  assert.equal(live.dots.size, 0);
  await Promise.all(h.tasks);
});

test('upstream attempt completion and route completion are separate gates', async () => {
  const h = harness(), store = new TraceStore(), live = new LiveRouting();
  let update = store.apply(frame(1, [route('r', [attempt('a', true, 'success')])]));
  live.ingest(store, update.play, h.cx); await h.advance(2500);
  assert.equal(live.dots.get('r').phase, 'result');
  update = store.apply(frame(2, [route('r', [attempt('a', true, 'success')], true)]));
  live.ingest(store, update.play, h.cx); await h.advance(1000);
  assert.equal(live.dots.size, 0);
});

test('hide/reset cancels held requests and bounded concurrent flights do not leave orphan dots', async () => {
  const h = harness(), store = new TraceStore(), live = new LiveRouting();
  const update = store.apply(frame(1, Array.from({ length: 8 }, (_, i) => route(String(i), [attempt()]))));
  live.ingest(store, update.play, h.cx); await h.advance(1000);
  assert.equal(live.dots.size, 4);
  live.stop(); await h.advance(1000); await Promise.all(h.tasks);
  assert.equal(live.dots.size, 0);
});

test('direct requests stay separate from routing groups and start before any model was selected', async () => {
  const h = harness(), store = new TraceStore(), live = new LiveRouting();
  live.group = { id: '@direct', direct: true, members: [] };
  let update = store.apply(frame(1, [{ ...route('direct'), group: '', groupRef: '' }, route('grouped', [attempt()])]));
  live.ingest(store, update.play, h.cx); await h.advance(1000);
  assert.equal(live.dots.size, 1);
  assert.equal(live.dots.get('direct').phase, 'selecting');
  assert.equal(live.nodes.length, 0);
  update = store.apply(frame(2, [{ ...route('direct', [attempt()]), group: '', groupRef: '' }], { ids: ['direct', 'grouped'] }));
  live.ingest(store, update.play, h.cx); await h.advance(1000);
  assert.equal(live.dots.get('direct').phase, 'held');
  assert.equal(live.nodes[0].model, 'a');
  live.stop(); await h.advance(100); await Promise.all(h.tasks);
});

test('trace projection keeps lifecycle flags while dropping account identity and prompt/error contents', () => {
  const data = projectTrace({ seq: 5, mine: true, now, by: { pid: 3, serves: 'private address' }, routes: [
    { id: 9, seq: 5, time: now, group: { id: 'g' }, model: 'group/g', done: false, session: 'private session',
      order: [{ id: 'private-account', provider: 'a', model: 'a', who: 'private email' }],
      tries: [{ id: 'private-account', model: 'a', done: true, status: 429, rest: { key: 'private key' }, error: 'private prompt' },
        { id: 'private-account', model: 'a', done: false }] }], ids: [9] });
  assert.equal(data.routes[0].attempts[0].retryable, true);
  assert.equal(data.routes[0].attempts[1].done, false);
  assert.equal(data.routes[0].attempts[0].status, 'error');
  assert.doesNotMatch(JSON.stringify(data), /private/);
  assert.deepEqual(data.ids, ['9']);
});

test('remote trace long-polls for 25s-capable reads and reloads on gateway takeover', async () => {
  const calls = [];
  const read = async (url, options) => { calls.push({ url, options }); return { seq: 2, mine: true, by: { pid: 20 }, routes: [], ids: [] }; };
  const data = await readTrace(read, { web: true, after: 99, epoch: 'old', wait: true });
  assert.equal(calls[0].url, '/api/gateway/trace?after=99&wait=1');
  assert.equal(calls[0].options.timeout, 30000);
  assert.equal(calls[1].url, '/api/gateway/trace?after=0');
  assert.equal(data.reset, true);
});

test('Usage ports cache inclusion, unknown-cache exclusion and stacked aggregation without inventing missing values', () => {
  const usage = { input: 100, output: 50, cache_read: 200, cache_write: 100, cache_unknown: 100 };
  assert.equal(tokenTotal(usage), 150);
  assert.equal(tokenTotal(usage, true), 450);
  assert.equal(cacheHit(usage), 2 / 3);
  assert.equal(cacheHit({ input: null, cache_read: 0, cache_write: 0 }), null);
  const bars = usageBars([{ ...usage, label: 'a' }, { ...usage, label: 'b' }], true, 1);
  assert.deepEqual(bars[0], { label: 'a – b', input: 800, output: 100, total: 900 });
});
