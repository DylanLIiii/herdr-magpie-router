import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { installPanel } from '../scripts/install-panel.js';
import { attachPanel, patchTabs } from '../scripts/attach-panel.js';

test('panel installation prepares a stack-only mod, configures the bridge, and preserves existing settings', async t => {
  const home = await mkdtemp(join(tmpdir(), 'magpie-panel-test-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  await mkdir(join(home, 'layouts'));
  const original = { 'settings.json': '{"theme":"paper","zoom":1.1}', 'keys.json': '{"global":{"ctrl-1":"terminal"}}',
    'shared.json': '{"layout":"main"}', 'layouts/main.json': '{"id":"root","type":"row"}' };
  for (const [path, content] of Object.entries(original)) await writeFile(join(home, path), content);
  const result = await installPanel({ home, name: 'my-magpie', endpoint: 'http://127.0.0.1:14327/api/dashboard' });
  assert.deepEqual(JSON.parse(await readFile(join(result.destination, 'mod.json'), 'utf8')), { place: 'none', size: 368, focusable: true });
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

test('attachment adds Routing after Changes in a cloned tab bar and shares the existing panel stack', async t => {
  const home = await mkdtemp(join(tmpdir(), 'magpie-panel-attach-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  await installPanel({ home });
  await mkdir(join(home, 'layouts'));
  const original = await readFile(new URL('../layouts/magpie.json', import.meta.url), 'utf8');
  const main = { id: 'root', type: 'row', theme: { dark: 'graphite', light: 'paper' }, children: [
    { id: 'sidebar', type: 'block', content: { mod: 'spaces' } },
    { id: 'work-body', type: 'row', children: [{ id: 'main', type: 'block', content: { tab: 'active' } },
      { id: 'panel', type: 'column', hidden: true, children: [{ id: 'panel-body', type: 'stack', active: 'files', children: [
        { id: 'files', type: 'block', content: { mod: 'files' } }, { id: 'changes', type: 'block', content: { mod: 'changes' } },
      ] }] }, { id: 'magpie-panel-sidebar', type: 'block', content: { mod: 'magpie-panel' } }] },
    { id: 'tabs', type: 'block', content: { mod: 'tabs' } },
  ] };
  await mkdir(join(home, 'mods', 'tabs'));
  const tabs = 'const enabled = shared("workspace.panels") ?? ["files", "changes"];\nreturn bar.when(enabled.includes("changes"), el => el.child(panelButton("changes", "Changes", "mods/changes/changes.svg")));';
  await writeFile(join(home, 'mods', 'tabs', 'main.js'), tabs);
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
  assert.equal(after.children[1].children.length, 2, 'old dedicated sidebar migrated');
  const panel = after.children[1].children[1];
  assert.equal(panel.children[0].children[2].id, 'routing');
  assert.equal(panel.children[0].children[2].content.mod, 'magpie-panel');
  assert.equal(panel.hidden, true);
  assert.equal(panel.size.px, 368);
  assert.equal(after.children[2].content.mod, 'magpie-panel-tabs');
  assert.equal(await readFile(join(home, 'mods', 'tabs', 'main.js'), 'utf8'), tabs);
  const cloned = await readFile(join(result.tabs, 'main.js'), 'utf8');
  assert.ok(cloned.indexOf('panelButton("routing"') > cloned.indexOf('panelButton("changes"'));
  assert.equal((await attachPanel({ home })).changed, false);
  assert.equal(await readFile(join(home, 'layouts', 'main.json'), 'utf8'), original);
});

test('tab patch preserves the installed behavior and refuses an incompatible source', () => {
  const source = 'const enabled = shared("workspace.panels") ?? ["files", "changes"];\n'
    + 'return bar.when(enabled.includes("changes"), el => el.child(panelButton("changes", "Changes", "mods/changes/changes.svg")))'
    + '.child(svg("mods/tabs/win-min.svg"));';
  const result = patchTabs(source, 'custom-tabs');
  assert.match(result, /new Set/);
  assert.match(result, /panelButton\("routing", "Routing", "mods\/custom-tabs\/routing.svg"\)/);
  assert.match(result, /mods\/custom-tabs\/win-min.svg/);
  assert.throws(() => patchTabs('a custom unrelated toolbar', 'custom-tabs'), /Refusing to guess/);
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
