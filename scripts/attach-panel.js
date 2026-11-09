import { readFile, writeFile, access, mkdir, readdir, cp, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const herdrLicense = new URL('../licenses/Apache-2.0.txt', import.meta.url);

const find = (node, predicate) => {
  if (predicate(node)) return node;
  for (const child of node.children || []) { const found = find(child, predicate); if (found) return found; }
  return null;
};
const hash = source => createHash('sha256').update(source).digest('hex');
const exists = path => lstat(path).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; });
const marker = '// herdr-magpie-routing-tabs v1';
const icon = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="3" cy="8" r="1.5"/><circle cx="13" cy="3" r="1.5"/><circle cx="13" cy="13" r="1.5"/><path d="M4.5 8H7V3h4.5M7 8v5h4.5"/></svg>';

/** Clone the installed tab bar's behavior, then add Routing immediately after Changes. */
export function patchTabs(source, cloneName) {
  const enabled = 'const enabled = shared("workspace.panels") ?? ["files", "changes"];';
  const changes = '.when(enabled.includes("changes"), el => el.child(panelButton("changes", "Changes", "mods/changes/changes.svg")))';
  if (source.split(enabled).length !== 2 || source.split(changes).length !== 2) {
    throw new Error('The installed Herdr tabs mod has changed. Refusing to guess where to add Routing; inspect its panelButton and enabled list first.');
  }
  return `${marker}\n` + source.replace(enabled, 'const enabled = [...new Set([...(shared("workspace.panels") ?? ["files", "changes"]), "routing"])];')
    .replace(changes, `${changes}\n      .child(panelButton("routing", "Routing", "mods/${cloneName}/routing.svg"))`)
    .replaceAll('mods/tabs/', `mods/${cloneName}/`);
}

/** Add Routing to a personal clone's existing Files/Changes panel stack. */
export async function attachPanel({ home = process.env.HERDR_APP_HOME || join(homedir(), '.config', 'herdr-app'), layout = 'main-magpie', name = 'magpie-panel', width = 368 } = {}) {
  for (const value of [layout, name]) if (!/^[a-z][a-z0-9-]{0,39}$/.test(value)) throw new Error('Use lowercase letters, digits and hyphens for layout and mod names.');
  if (['main', 'terminals', 'win98'].includes(layout)) throw new Error('Shipped layouts are protected. First run: herdr-app do layout.clone --name main --as main-magpie');
  width = Number(width);
  if (!Number.isInteger(width) || width < 280 || width > 640) throw new Error('Panel width must be between 280 and 640.');
  const base = resolve(home), file = join(base, 'layouts', `${layout}.json`), cloneName = `${name}-tabs`;
  await access(join(base, 'mods', name, 'main.js'));
  const before = await readFile(file, 'utf8'), tree = JSON.parse(before);
  const row = find(tree, node => node.id === 'work-body' && node.type === 'row');
  const panel = find(tree, node => node.id === 'panel'), body = find(tree, node => node.id === 'panel-body' && node.type === 'stack');
  const tabs = find(tree, node => node.id === 'tabs' && node.content?.mod);
  if (!row || !panel || !body || !tabs) throw new Error('Expected the default workspace tabs and Files/Changes panel stack. Use a clone of main.');
  if (!['tabs', cloneName].includes(tabs.content.mod)) throw new Error('This workspace uses a personal tab bar. Refusing to replace it; add Routing to that mod explicitly.');
  const routing = body.children.find(node => node.id === 'routing');
  if (!routing && find(tree, node => node.id === 'routing')) throw new Error('Another block already uses the routing id. Refusing duplicate layout ids.');
  if (routing && routing.content?.mod !== name) throw new Error('A different Routing panel already exists.');
  const sourceDir = join(base, 'mods', 'tabs'), cloneDir = join(base, 'mods', cloneName);
  const source = await readFile(join(sourceDir, 'main.js'), 'utf8');
  const patched = patchTabs(source, cloneName);
  if (await exists(cloneDir)) {
    const metadata = JSON.parse(await readFile(join(cloneDir, '.magpie-clone.json'), 'utf8').catch(() => '{}'));
    const installed = await readFile(join(cloneDir, 'main.js'), 'utf8').catch(() => '');
    if (!metadata.hash || hash(installed) !== metadata.hash || metadata.hash !== hash(patched)) {
      throw new Error(`Existing ${cloneName} was edited or its source changed. Keep it and use a new panel name.`);
    }
  } else {
    await mkdir(cloneDir);
    for (const entry of await readdir(sourceDir, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || ['main.js', 'mod.json', 'jsconfig.json'].includes(entry.name) || entry.name.endsWith('.d.ts')) continue;
      await cp(join(sourceDir, entry.name), join(cloneDir, entry.name), { recursive: true, errorOnExist: true, force: false });
    }
    if (!await exists(join(cloneDir, 'LICENSE'))) await writeFile(join(cloneDir, 'LICENSE'), await readFile(herdrLicense), { flag: 'wx' });
    await writeFile(join(cloneDir, 'MAGPIE-MODIFICATIONS.txt'), 'Personal copy of the installed Herdr tabs mod (Apache-2.0). Modified by Herdr Magpie Router to add Routing after Changes and include routing in the per-space panel selection. Original source remains installed under mods/tabs.\n', { flag: 'wx' });
    await writeFile(join(cloneDir, 'routing.svg'), icon, { flag: 'wx' });
    await writeFile(join(cloneDir, 'mod.json'), JSON.stringify({ place: 'none', cloned_from: { name: 'tabs', version: tree.cloned_from?.version || 'installed' } }), { flag: 'wx' });
    await writeFile(join(cloneDir, '.magpie-clone.json'), JSON.stringify({ hash: hash(patched), source: hash(source) }), { flag: 'wx' });
    await writeFile(join(cloneDir, 'main.js'), patched, { flag: 'wx' });
  }
  // Migrate the old dedicated sidebar into the common panel stack.
  row.children = row.children.filter(node => !(node.id.startsWith(`${name}-sidebar`) && node.content?.mod === name));
  if (!routing) body.children.push({ id: 'routing', type: 'block', content: { mod: name, props: { presentation: 'sidebar' } } });
  tabs.content.mod = cloneName;
  if (!panel.size) panel.size = { px: width };
  const content = `${JSON.stringify(tree, null, 2)}\n`;
  if (content === before) return { file, changed: false, tabs: cloneDir };
  const backup = `${file}.before-magpie-${Date.now()}`;
  await writeFile(backup, before, { flag: 'wx' });
  if (await readFile(file, 'utf8') !== before) throw new Error('The layout changed during installation. Retry after the edit has finished.');
  await writeFile(file, content);
  return { file, backup, changed: true, tabs: cloneDir };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const options = {};
    for (let index = 2; index < process.argv.length; index += 2) {
      const key = { '--home': 'home', '--layout': 'layout', '--name': 'name', '--width': 'width' }[process.argv[index]];
      if (!key || !process.argv[index + 1]) throw new Error('Usage: node scripts/attach-panel.js [--home DIR] [--layout NAME] [--name MOD] [--width PX]');
      options[key] = process.argv[index + 1];
    }
    const result = await attachPanel(options);
    console.log(`${result.changed ? 'Added Routing after Files and Changes' : 'Routing already attached'}: ${result.file}\nCheck cloned tab bar: herdr-app check ${JSON.stringify(result.tabs)}\nClick Routing to open or close the sidebar.`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
