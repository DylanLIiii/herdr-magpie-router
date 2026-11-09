import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { installPanel } from '../scripts/install-panel.js';
import { attachPanel } from '../scripts/attach-panel.js';

test('panel installation docks right, configures the bridge, and preserves every existing layout and setting', async t => {
  const home = await mkdtemp(join(tmpdir(), 'magpie-panel-test-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  await mkdir(join(home, 'layouts'));
  const original = { 'settings.json': '{"theme":"paper","zoom":1.1}', 'keys.json': '{"global":{"ctrl-1":"terminal"}}',
    'shared.json': '{"layout":"main"}', 'layouts/main.json': '{"id":"root","type":"row"}' };
  for (const [path, content] of Object.entries(original)) await writeFile(join(home, path), content);
  const result = await installPanel({ home, name: 'my-magpie', endpoint: 'http://127.0.0.1:14327/api/dashboard' });
  assert.deepEqual(JSON.parse(await readFile(join(result.destination, 'mod.json'), 'utf8')), { place: 'right', size: 368, focusable: true });
  const config = (await import(pathToFileURL(join(result.destination, 'config.js')))).default;
  assert.equal(config.endpoint, 'http://127.0.0.1:14327/api/dashboard');
  assert.equal(config.modName, 'my-magpie', 'renamed mods can detect whether their own block is visible');
  assert.deepEqual((await readdir(home)).sort(), ['keys.json', 'layouts', 'mods', 'settings.json', 'shared.json']);
  for (const [path, content] of Object.entries(original)) assert.equal(await readFile(join(home, path), 'utf8'), content);
  assert.deepEqual(await readdir(join(home, 'layouts')), ['main.json']);
  assert.deepEqual(await readdir(join(home, 'mods')), ['my-magpie']);
  const before = await readFile(join(result.destination, 'main.js'), 'utf8');
  await assert.rejects(installPanel({ home, name: 'my-magpie' }), /Already exists/);
  assert.equal(await readFile(join(result.destination, 'main.js'), 'utf8'), before);
});

test('attachment adds only a right-hand block to the default workspace clone and is idempotent', async t => {
  const home = await mkdtemp(join(tmpdir(), 'magpie-panel-attach-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  await installPanel({ home });
  await mkdir(join(home, 'layouts'));
  const original = await readFile(new URL('../layouts/magpie.json', import.meta.url), 'utf8');
  const main = { id: 'root', type: 'row', theme: { dark: 'graphite', light: 'paper' }, children: [
    { id: 'sidebar', type: 'block', content: { mod: 'spaces' } },
    { id: 'work-body', type: 'row', children: [{ id: 'main', type: 'block', content: { tab: 'active' } }] },
  ] };
  const personal = JSON.stringify(main);
  await writeFile(join(home, 'layouts', 'main.json'), original);
  await writeFile(join(home, 'layouts', 'main-magpie.json'), personal);
  await assert.rejects(attachPanel({ home, layout: 'main' }), /protected/);
  const result = await attachPanel({ home });
  assert.equal(result.changed, true);
  assert.equal(await readFile(result.backup, 'utf8'), personal);
  const after = JSON.parse(await readFile(result.file, 'utf8'));
  assert.deepEqual(after.children[0], main.children[0]);
  assert.deepEqual(after.theme, main.theme);
  assert.deepEqual(after.children[1].children[0], main.children[1].children[0]);
  assert.equal(after.children[1].children[1].content.mod, 'magpie-panel');
  assert.equal(after.children[1].children[1].size.px, 368);
  assert.equal((await attachPanel({ home })).changed, false);
  assert.equal(await readFile(join(home, 'layouts', 'main.json'), 'utf8'), original);
});

test('panel installer rejects unsafe names, credential-bearing URLs, invalid widths and dangling symlinks', async t => {
  const home = await mkdtemp(join(tmpdir(), 'magpie-panel-test-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  for (const options of [{ name: '../oops' }, { endpoint: 'http://user:secret@localhost/api/dashboard' },
    { endpoint: 'http://localhost/api/dashboard?token=secret' }, { width: 120 }, { width: 'bad' }]) {
    await assert.rejects(installPanel({ home, ...options }));
  }
  assert.deepEqual(await readdir(home), []);
  await mkdir(join(home, 'mods'));
  await symlink('/nonexistent/magpie-panel-test', join(home, 'mods', 'magpie-panel'));
  await assert.rejects(installPanel({ home }), /Already exists/);
});
