import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { demoDashboard } from './fixtures/demo.js';
import { strategyInfo, destinationKey, rowY } from '../mods/magpie-dashboard/routing.js';
import { TraceStore, LiveRouting } from '../mods/magpie-dashboard/live-routing.js';
import { tokenTotal, cacheHit, usageBars } from '../mods/magpie-dashboard/usage.js';
import * as presentation from '../mods/magpie-dashboard/presentation.js';

async function host(fetchImpl, props = {}, clock = Date, allowanceFetch = () => Response.json({ cards: [] })) {
  let source = await readFile(new URL('../mods/magpie-dashboard/main.js', import.meta.url), 'utf8');
  source = source.replace(/^import .*?;\n/gm, '').replace('export default class', 'globalThis.Mod = class');
  const controls = new Map(), strings = [];
  const element = () => {
    let id;
    let proxy;
    proxy = new Proxy({}, { get: (_, name) => (...args) => {
      if (name === 'child' && typeof args[0] === 'string') strings.push(args[0]);
      if (name === 'children') for (const value of args[0]) if (typeof value === 'string') strings.push(value);
      if (name === 'when' && args[0]) return args[1](proxy);
      if (name === 'id') { id = args[0]; controls.set(id, {}); }
      if (id && ['on_click', 'on_key_down'].includes(name)) controls.get(id)[name] = args[0];
      return proxy;
    } });
    return proxy;
  };
  let active = 'magpie-dashboard';
  let focused = false;
  let panelHidden = false;
  const context = { fetch: url => url.includes('/api/routing') ? Response.json({ mode: new URL(url).searchParams.get('mode'), seq: 0, epoch: 'fixture', mine: true, routes: [], ids: [] }) : url.includes('/api/allowances') ? allowanceFetch(url) : fetchImpl(url), Date: clock, Intl, View: class {}, div: element, svg: element, h_flex: element, v_flex: element, ...presentation,
    strategyInfo, destinationKey, rowY, TraceStore, LiveRouting, tokenTotal, cacheHit, usageBars,
    ConnectionForm: class { open() {} dispose() {} render() { return element(); } },
    config: { endpoint: 'http://127.0.0.1:4317/api/dashboard', modName: 'magpie-panel' },
    theme: () => ({}), layout: () => ({ id: 'magpie-pages', active, children: [{ id: 'panel', type: 'block', hidden: panelHidden, content: { mod: 'magpie-panel' } }] }),
    hostProps: () => props, nextCommand: () => new Promise(() => {}) };
  vm.runInNewContext(source, context);
  const tasks = [], timers = [], scheduled = [];
  const cx = { notify() {}, stop_propagation() {}, focus_handle: () => ({ focus() { focused = true; } }),
    timer: { every: (_, callback) => timers.push(callback), after: (delay, callback) => scheduled.push({ delay, callback }) }, spawn: callback => {
      const task = callback(cx);
      if (!callback.toString().includes('nextCommand')) tasks.push(task);
      return task;
    } };
  const mod = new context.Mod();
  mod.init({}, cx); // Real Herdr provides layout props through herdr.props(), not this argument.
  const settle = async () => { while (tasks.length) await Promise.all(tasks.splice(0)); };
  return { mod, cx, settle, timers, scheduled, controls, strings, hide: () => { active = 'magpie-workspace'; panelHidden = true; }, focused: () => focused };
}
const response = (url, extra = {}) => {
  const parsed = new URL(url);
  return Response.json({ ...demoDashboard(parsed.searchParams.get('period')), mode: parsed.searchParams.get('mode'), ...extra });
};

test('native Routes, subscription Usage and Cost work with host props and keyboard controls; Demo and Pause are absent', async () => {
  const calls = [];
  const h = await host(async url => { calls.push(url); return response(url); }, { endpoint: 'http://127.0.0.1:14317/api/dashboard', mode: 'demo' });
  await h.settle();
  assert.match(calls[0], /^http:\/\/127\.0\.0\.1:14317\/api\/dashboard\?/);
  assert.equal(h.mod.mode, 'live', 'obsolete demo props cannot enable synthetic data');
  assert.equal(h.mod.sidebar, true);
  assert.equal(h.mod.width, 368);
  h.mod.render();
  assert.ok(h.controls.has('routing-paths'), 'the live diagram is immediately available');
  assert.equal([...h.controls.keys()].some(key => key.startsWith('route-group-') || key === 'route-follow'), false);
  assert.equal(h.mod.motion, true);
  assert.equal(h.controls.has('page-mode'), false); assert.equal(h.controls.has('page-pause'), false);
  assert.equal(h.controls.has('route-motion'), false, 'motion is a settings preference');
  h.mod.toggleMotion(h.cx);
  assert.equal(h.mod.motion, false);
  assert.equal(h.mod.live.dots.size, 0);
  h.controls.get('request-3').on_click({}, h.cx);
  assert.equal(h.mod.details, true);
  assert.equal(h.mod.traceVisible(), true, 'inspecting a request continues live data updates');
  assert.equal(h.mod.live.canRun(), false, 'detail view does not retain invisible motion');
  assert.equal(h.mod.selected, h.mod.requests()[3].id);
  h.mod.render();
  h.controls.get('panel-back').on_key_down({ key: 'enter' }, h.cx);
  assert.equal(h.mod.details, false);
  h.controls.get('page-usage').on_key_down({ key: 'enter' }, h.cx);
  assert.equal(h.mod.section, 'usage');
  await h.settle(); h.mod.render();
  assert.ok(h.controls.has('subscription-usage'));
  h.controls.get('page-cost').on_key_down({ key: 'enter' }, h.cx);
  assert.equal(h.mod.section, 'cost'); h.mod.render();
  assert.ok(h.controls.has('cost-legend'));
  h.controls.get('period-7d').on_click({}, h.cx);
  await h.settle();
  assert.equal(h.mod.snapshot.period, '7d');
  assert.equal(h.focused(), true);
  h.mod.width = 380;
  assert.ok(h.mod.render(), 'narrow usage state renders');
  h.mod.section = 'routes';
  assert.ok(h.mod.render(), 'narrow routes state renders');
  const before = h.mod.selected;
  h.mod.key({ key: 'down' }, h.cx);
  assert.notEqual(h.mod.selected, before);
});

test('live display needs no configured groups and exposes group/strategy only as request metadata', async () => {
  const h = await host(url => response(url, { configuredGroups: null }));
  await h.settle();
  const entries = [
    { id: 'coding', group: 'coding', groupName: 'Coding', strategy: 'order', provider: 'p', model: 'm', done: false, attempts: [], timestamp: new Date().toISOString() },
    { id: 'reasoning', group: 'reasoning', strategy: 'weight', provider: 'q', model: 'n', done: false, attempts: [], timestamp: new Date().toISOString() },
    { id: 'direct', group: '', provider: 'r', model: 'o', done: false, attempts: [], timestamp: new Date().toISOString() },
  ];
  for (const row of entries) h.mod.trace.routes.set(row.id, row);
  h.mod.live.ingest(h.mod.trace, [], h.cx, { animate: false });
  h.mod.render();
  assert.ok(h.controls.has('routing-paths'));
  for (const row of entries) assert.ok(h.mod.requests().some(request => request.id === row.id));
  assert.equal(h.mod.routeInfo(entries[0]).strategy, 'In order');
  assert.equal(h.mod.routeInfo(entries[1]).strategy, 'By weight');
  assert.equal(h.mod.routeInfo(entries[2]).name, 'Direct');
  assert.equal([...h.controls.keys()].some(key => key.startsWith('route-group-') || key === 'route-follow'), false);
  const generation = h.mod.live.generation;
  h.mod.key({ key: 'right' }, h.cx);
  assert.equal(h.mod.live.generation, generation);
  h.mod.sidebar = false; h.mod.render();
  assert.equal([...h.controls.keys()].some(key => key.startsWith('route-group-') || key === 'route-follow'), false, 'legacy page does not reintroduce group selection');
});

test('initial connection renders a skeleton without an error, status duplication or service URL', async () => {
  let release;
  const h = await host(async url => { await new Promise(resolve => { release = resolve; }); return response(url); });
  h.mod.render();
  assert.ok(h.controls.has('skeleton-routes'));
  assert.equal(h.strings.some(value => /not connected|unavailable|error|https?:/i.test(value)), false);
  release(); await h.settle();
  h.strings.length = 0; h.mod.render();
  assert.equal(h.strings.some(value => /https?:|Connected|Pause|Demo|Following/.test(value)), false);
  assert.ok(h.strings.some(value => value.startsWith('Cache ')));
});

test('saving a connection clears old service data and late responses cannot replace the new service', async () => {
  let release, calls = 0;
  const h = await host(async url => {
    if (++calls === 1) { await new Promise(resolve => { release = resolve; }); return response(url, { marker: 'old', connectionRevision: 0 }); }
    return response(url, { marker: 'new', connectionRevision: 1 });
  });
  h.mod.trace.routes.set('old', { id: 'old', group: 'private-old-group', attempts: [], timestamp: new Date().toISOString() });
  h.mod.useConnection({ revision: 1 }, h.cx);
  assert.equal(h.mod.snapshot, null);
  assert.equal(h.mod.trace.routes.has('old'), false);
  assert.equal(h.mod.mode, 'live');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.mod.snapshot.marker, 'new');
  release(); await h.settle();
  assert.equal(h.mod.snapshot.marker, 'new');
  assert.equal(h.mod.connectionRevision, 1);
});

test('allowances arriving during initial revision discovery load, but late old-service allowances are rejected', async () => {
  let release, calls = 0, revision = 0;
  const h = await host(url => response(url, { connectionRevision: revision }), { section: 'usage' }, Date, async () => {
    const at = revision;
    if (++calls <= 2) await new Promise(resolve => { release = resolve; });
    return Response.json({ cards: [{ name: `Service ${at}` }], connectionRevision: at });
  });
  await new Promise(resolve => setImmediate(resolve));
  release(); await h.settle();
  assert.equal(h.mod.allowances.cards[0].name, 'Service 0');
  h.mod.loadAllowances(h.cx, true);
  revision = 1;
  h.mod.useConnection({ revision: 1 }, h.cx);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.mod.allowances.cards[0].name, 'Service 1');
  release(); await h.settle();
  assert.equal(h.mod.allowances.cards[0].name, 'Service 1', 'late old-service reading cannot replace current allowances');
});

test('period switches cannot be overwritten by a late response from another period', async () => {
  let release;
  let calls = 0;
  const h = await host(async url => { if (++calls === 1) await new Promise(resolve => { release = resolve; }); return response(url); });
  h.mod.change('period', '30d', h.cx);
  assert.equal(calls, 1);
  release(); await h.settle();
  assert.equal(h.mod.snapshot.period, '30d');
  assert.equal(calls, 2);
});

test('failed refresh retains last data and obsolete demo shortcuts cannot replace live data', async () => {
  let fail = false;
  const h = await host(url => fail ? Promise.resolve(Response.json({ ...demoDashboard('today'), mode: 'live', error: 'Service unavailable' }, { status: 503 })) : response(url));
  await h.settle();
  const previous = h.mod.snapshot;
  fail = true;
  h.mod.refresh(h.cx); await h.settle();
  assert.equal(h.mod.snapshot, previous);
  assert.match(h.mod.error, /Service unavailable/);
  h.mod.change('mode', 'demo', h.cx); await h.settle();
  assert.equal(h.mod.snapshot, previous);
  assert.equal(h.mod.mode, 'live');
});

test('hidden page skips automatic polling and close stops new requests', async () => {
  let now = 100000, calls = 0;
  const clock = class extends Date { static now() { return now; } };
  const h = await host(url => { calls++; return response(url); }, {}, clock);
  await h.settle();
  h.hide(); now += 20000; h.timers[0](h.cx);
  assert.equal(calls, 1);
  h.mod.close(); h.mod.refresh(h.cx);
  assert.equal(calls, 1);
});

test('watchdog bounds stalled requests and rejects late results after retry without a Pause control', async () => {
  let now = 100000, calls = 0, release;
  const clock = class extends Date { static now() { return now; } };
  const h = await host(async url => {
    if (++calls === 1) { await new Promise(resolve => { release = resolve; }); return response(url, { marker: 'old' }); }
    return response(url, { marker: 'new' });
  }, {}, clock);
  now += 15000; h.timers[1](h.cx);
  assert.equal(h.mod.loading, false);
  assert.equal(h.mod.blocked, true);
  assert.match(h.mod.error, /15 seconds/);
  h.mod.refresh(h.cx);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.mod.snapshot.marker, 'new');
  release(); await h.settle();
  assert.equal(h.mod.snapshot.marker, 'new');
});
