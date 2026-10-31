import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { demoSnapshot } from '../server/demo.js';

async function host(fetchImpl, clock = Date) {
  let source = await readFile(new URL('../mods/magpie-router/main.js', import.meta.url), 'utf8');
  source = source.replace(/^import .*?;\n/gm, '').replace('export default class', 'globalThis.Mod = class');
  const noop = () => {};
  const element = () => new Proxy({}, { get: () => () => element() });
  const context = { fetch: fetchImpl, Date: clock, View: class {}, div: element, h_flex: element, v_flex: element, theme: () => ({}) };
  vm.runInNewContext(source, context);
  const tasks = [];
  const timers = [];
  const cx = { notify: noop, timer: { every: (_, callback) => timers.push(callback) }, spawn: callback => { const task = callback(cx); tasks.push(task); return task; } };
  const mod = new context.Mod();
  mod.init({}, cx);
  const settle = async () => { while (tasks.length) await Promise.all(tasks.splice(0)); };
  return { mod, cx, settle, timers };
}

test('native adapter switches modes serially and rejects stale responses', async () => {
  let release;
  const calls = [];
  const fake = async url => {
    calls.push(url);
    if (calls.length === 1) await new Promise(resolve => { release = resolve; });
    return Response.json({ ...demoSnapshot(), mode: url.includes('mode=demo') ? 'demo' : 'live' });
  };
  const { mod, cx, settle } = await host(fake);
  mod.switchMode('demo', cx);
  assert.equal(calls.length, 1);
  release();
  await settle();
  assert.equal(calls.length, 2);
  assert.equal(mod.snapshot.mode, 'demo');
  assert.equal(mod.requests().length, 16);
  assert.ok(mod.render(cx));
});

test('native adapter preserves useful disconnected snapshots and close stops refresh', async () => {
  let calls = 0;
  const { mod, cx, settle } = await host(async () => {
    calls++;
    return Response.json({ mode: 'live', connection: 'unconfigured', error: '配置数据源', requests: [], groups: [], providers: [] }, { status: 503 });
  });
  await settle();
  assert.equal(mod.snapshot.connection, 'unconfigured');
  assert.match(mod.error, /配置数据源/);
  assert.ok(mod.render(cx));
  mod.close();
  mod.refresh(cx);
  assert.equal(calls, 1);
});

test('native watchdog releases a stalled fetch and late results cannot overwrite a retry', async () => {
  let now = 100000;
  let release;
  let calls = 0;
  const clock = class extends Date { static now() { return now; } };
  const { mod, cx, settle, timers } = await host(async () => {
    calls++;
    if (calls === 1) {
      await new Promise(resolve => { release = resolve; });
      return Response.json({ ...demoSnapshot(), mode: 'live', source: { label: 'late-stale-result' } });
    }
    return Response.json({ ...demoSnapshot(), mode: 'live', source: { label: 'retry-result' } });
  }, clock);
  now += 15000;
  timers[0](cx);
  assert.equal(mod.loading, false);
  assert.equal(mod.paused, true, 'timeout stops automatic accumulation of unresolved fetches');
  assert.match(mod.error, /15 秒/);
  mod.refresh(cx);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(mod.snapshot.source.label, 'retry-result');
  release();
  await settle();
  assert.equal(mod.snapshot.source.label, 'retry-result');
  assert.equal(mod.loading, false);
  assert.equal(calls, 2);
});
