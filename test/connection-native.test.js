import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

async function host(fetchImpl, preferences = {}) {
  let source = await readFile(new URL('../mods/magpie-dashboard/connection.js', import.meta.url), 'utf8');
  source = source.replace(/^import .*?;\n/gm, '').replace('export class ConnectionForm', 'globalThis.Form = class ConnectionForm');
  const inputs = [], controls = new Map(), stored = [], tasks = [], strings = [];
  const element = () => {
    let id, proxy;
    proxy = new Proxy({}, { get: (_, name) => (...args) => {
      if (name === 'child' && typeof args[0] === 'string') strings.push(args[0]);
      if (name === 'id') { id = args[0]; controls.set(id, {}); }
      if (id && ['on_click', 'on_key_down'].includes(name)) controls.get(id)[name] = args[0];
      return proxy;
    } }); return proxy;
  };
  const InputState = { new() {
    let value = ''; const handlers = {};
    const input = { masked: false, focused: false, value: () => value,
      set_value(next) { value = next; }, set_masked(masked) { input.masked = masked; },
      focus() { input.focused = true; }, on(name, callback) { handlers[name] = callback; }, handlers };
    inputs.push(input); return input;
  } };
  const context = { fetch: fetchImpl, div: element, h_flex: element, v_flex: element, InputState, Input: { new: element },
    localStorage: { setItem: (...args) => stored.push(args) } };
  vm.runInNewContext(source, context);
  const saved = [], closed = [], deadlines = [];
  const cx = { notify() {}, stop_propagation() {}, timer: { after(_ms, fn) { deadlines.push(fn); } }, spawn(fn) { const task = fn(cx); tasks.push(task); return task; } };
  const form = new context.Form('http://127.0.0.1:4317/api/dashboard', info => saved.push(info), () => closed.push(true), preferences);
  return { form, cx, inputs, controls, strings, saved, closed, stored, deadlines, async settle() { while (tasks.length) await Promise.all(tasks.splice(0)); } };
}
const metadata = { url: 'http://127.0.0.1:3430', cookiePort: '', hasKey: true, token: 'test-csrf', revision: 1 };

test('native key input is masked and write-only; Test does not save and Save clears its buffer', async () => {
  const calls = [];
  const h = await host(async (url, options) => {
    calls.push({ url, options });
    if (!options) return Response.json(metadata);
    if (url.endsWith('/test')) return Response.json({ ok: true, partial: false, routingActive: true,
      checks: [{ name: 'Routing', ok: true }, { name: 'Usage', ok: true }] });
    return Response.json({ ...metadata, revision: 2 });
  });
  h.form.open(h.cx); await h.settle();
  assert.equal(h.inputs[1].masked, true); assert.equal(h.inputs[1].value(), '');
  assert.equal(h.inputs[0].value(), metadata.url);
  h.inputs[1].set_value('fixture-only-web-key');
  h.form.render({}); h.controls.get('connection-test').on_key_down({ key: 'enter' }, h.cx);
  await h.settle();
  assert.equal(h.saved.length, 0); assert.match(h.form.message, /Connection verified/);
  assert.equal(JSON.parse(calls[1].options.body).key, 'fixture-only-web-key');
  assert.equal(calls[1].options.headers['X-Magpie-Config-Token'], metadata.token);
  h.form.render({}); h.controls.get('connection-save').on_click({}, h.cx); await h.settle();
  assert.equal(h.saved.length, 1); assert.equal(h.inputs[1].value(), '');
  assert.equal(h.form.closed, true); assert.equal(h.stored.length, 0, 'key never enters Mod localStorage');
});

test('native Settings keeps labels, help, write-only key and Motion controls consistent after visual calibration', async () => {
  let motion = true, toggles = 0;
  const h = await host(async () => Response.json(metadata), { motion: () => motion, toggleMotion: () => { motion = !motion; toggles++; } });
  h.form.open(h.cx); await h.settle(); h.form.render({});
  for (const id of ['connection-url', 'connection-key', 'connection-port', 'connection-test', 'connection-save', 'motion-preference', 'route-motion']) assert.ok(h.controls.has(id), `missing ${id}`);
  assert.equal(h.inputs[1].masked, true); assert.equal(h.inputs[1].value(), '');
  for (const copy of ['Service URL', 'Web access key', 'Internal Web port · optional', 'Key saved. Leave blank to keep it for the same address.', 'Key stored privately on this computer', 'Routing motion']) assert.ok(h.strings.includes(copy), `missing ${copy}`);
  h.controls.get('route-motion').on_key_down({ key: 'space' }, h.cx);
  assert.equal(toggles, 1); assert.equal(motion, false);
  h.strings.length = 0; h.form.render({}); assert.ok(h.strings.includes('Off'));
});

test('native form clears the key on Back, ignores late tests, and suppresses duplicate submissions', async () => {
  let release;
  const h = await host(async (_url, options) => {
    if (!options) return Response.json(metadata);
    await new Promise(resolve => { release = resolve; });
    return Response.json({ ok: true, partial: false, routingActive: true, checks: [] });
  });
  h.form.open(h.cx); await h.settle();
  h.form.key.set_value('fixture-only');
  h.form.submit(false, h.cx);
  assert.equal(h.form.busy, 'test');
  h.form.submit(true, h.cx); // no second request while testing
  h.form.close(h.cx); assert.equal(h.form.key.value(), '');
  release(); await h.settle();
  assert.equal(h.saved.length, 0); assert.equal(h.closed.length, 1);
  assert.equal(h.form.message, '');
});

test('a stalled save unlocks navigation and requires reading back settings before another write', async () => {
  let release;
  const h = await host(async (_url, options) => {
    if (!options) return Response.json(metadata);
    await new Promise(resolve => { release = resolve; });
    return Response.json({ ...metadata, revision: 2 });
  });
  h.form.open(h.cx); await h.settle();
  h.form.submit(true, h.cx);
  assert.equal(h.form.busy, 'save');
  h.deadlines.at(-1)(h.cx);
  assert.equal(h.form.busy, ''); assert.equal(h.form.info, null);
  assert.match(h.form.error, /read back/);
  release(); await h.settle();
  assert.equal(h.saved.length, 0, 'late save response cannot change a newer form');
  h.form.close(h.cx); assert.equal(h.closed.length, 1);
});

test('native save errors leave the form open and require a valid metadata token before any write', async () => {
  const h = await host(async (_url, options) => options ? Response.json({ error: 'Previous connection is unchanged.' }, { status: 500 }) : Response.json(metadata));
  h.form.submit(true, h.cx); assert.equal(h.saved.length, 0);
  h.form.open(h.cx); await h.settle();
  h.form.submit(true, h.cx); await h.settle();
  assert.equal(h.form.closed, false); assert.equal(h.saved.length, 0);
  assert.match(h.form.error, /unchanged/);
  h.form.dispose(); assert.equal(h.form.key.value(), '');
});
