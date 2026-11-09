import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { demoDashboard } from '../server/demo.js';
import { RouteSignal, strategyInfo, destinationKey, rowY } from '../mods/magpie-dashboard/routing.js';

async function host(fetchImpl, props = {}, clock = Date) {
  let source = await readFile(new URL('../mods/magpie-dashboard/main.js', import.meta.url), 'utf8');
  source = source.replace(/^import .*?;\n/gm, '').replace('export default class', 'globalThis.Mod = class');
  const controls = new Map();
  const element = () => {
    let id;
    let proxy;
    proxy = new Proxy({}, { get: (_, name) => (...args) => {
      if (name === 'id') { id = args[0]; controls.set(id, {}); }
      if (id && ['on_click', 'on_key_down'].includes(name)) controls.get(id)[name] = args[0];
      return proxy;
    } });
    return proxy;
  };
  let active = 'magpie-dashboard';
  let focused = false;
  let panelHidden = false;
  const context = { fetch: fetchImpl, Date: clock, Intl, View: class {}, div: element, h_flex: element, v_flex: element,
    RouteSignal, strategyInfo, destinationKey, rowY,
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
  return { mod, cx, settle, timers, scheduled, controls, hide: () => { active = 'magpie-workspace'; panelHidden = true; }, focused: () => focused };
}
const response = (url, extra = {}) => {
  const parsed = new URL(url);
  return Response.json({ ...demoDashboard(parsed.searchParams.get('period')), mode: parsed.searchParams.get('mode'), ...extra });
};

test('dashboard consumes actual host props, renders routes and usage, and buttons are keyboard operable', async () => {
  const calls = [];
  const h = await host(async url => { calls.push(url); return response(url); }, { endpoint: 'http://127.0.0.1:14317/api/dashboard', mode: 'demo' });
  await h.settle();
  assert.match(calls[0], /^http:\/\/127\.0\.0\.1:14317\/api\/dashboard\?/);
  assert.equal(h.mod.mode, 'demo');
  assert.equal(h.mod.sidebar, true);
  assert.equal(h.mod.width, 368);
  h.mod.render();
  h.controls.get('route-motion').on_click({}, h.cx);
  assert.equal(h.mod.motion, false);
  assert.equal(h.mod.signal.moving, false);
  h.controls.get('request-3').on_click({}, h.cx);
  assert.equal(h.mod.details, true);
  assert.equal(h.mod.selected, h.mod.requests()[3].id);
  h.mod.render();
  h.controls.get('panel-back').on_key_down({ key: 'enter' }, h.cx);
  assert.equal(h.mod.details, false);
  h.controls.get('page-usage').on_key_down({ key: 'enter' }, h.cx);
  assert.equal(h.mod.section, 'usage');
  h.mod.render();
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

test('failed refresh retains explicitly stale data; mode changes clear it and never fall back to demo', async () => {
  let fail = false;
  const h = await host(url => fail ? Promise.resolve(Response.json({ ...demoDashboard('today'), mode: 'live', error: 'Service unavailable' }, { status: 503 })) : response(url));
  await h.settle();
  const previous = h.mod.snapshot;
  fail = true;
  h.mod.refresh(h.cx); await h.settle();
  assert.equal(h.mod.snapshot, previous);
  assert.match(h.mod.error, /Service unavailable/);
  h.mod.change('mode', 'demo', h.cx); await h.settle();
  assert.equal(h.mod.snapshot, null);
  assert.match(h.mod.error, /incompatible/);
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

test('watchdog pauses a stalled request and rejects its late result after retry', async () => {
  let now = 100000, calls = 0, release;
  const clock = class extends Date { static now() { return now; } };
  const h = await host(async url => {
    if (++calls === 1) { await new Promise(resolve => { release = resolve; }); return response(url, { marker: 'old' }); }
    return response(url, { marker: 'new' });
  }, {}, clock);
  now += 15000; h.timers[0](h.cx);
  assert.equal(h.mod.loading, false);
  assert.equal(h.mod.paused, true);
  assert.match(h.mod.error, /15 seconds/);
  h.mod.refresh(h.cx);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.mod.snapshot.marker, 'new');
  release(); await h.settle();
  assert.equal(h.mod.snapshot.marker, 'new');
});
