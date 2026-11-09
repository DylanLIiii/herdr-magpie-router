import { readFile, writeFile, access } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const find = (node, predicate) => {
  if (predicate(node)) return node;
  for (const child of node.children || []) { const found = find(child, predicate); if (found) return found; }
  return null;
};

/** Add one sidebar block to a personal copy of Herdr's default workspace. */
export async function attachPanel({ home = process.env.HERDR_APP_HOME || join(homedir(), '.config', 'herdr-app'), layout = 'main-magpie', name = 'magpie-panel', width = 368 } = {}) {
  for (const value of [layout, name]) if (!/^[a-z][a-z0-9-]{0,39}$/.test(value)) throw new Error('Use lowercase letters, digits and hyphens for layout and mod names.');
  if (['main', 'terminals', 'win98'].includes(layout)) throw new Error('Shipped layouts are protected. First run: herdr-app do layout.clone --name main --as main-magpie');
  width = Number(width);
  if (!Number.isInteger(width) || width < 280 || width > 640) throw new Error('Panel width must be between 280 and 640.');
  const base = resolve(home), file = join(base, 'layouts', `${layout}.json`);
  await access(join(base, 'mods', name, 'main.js'));
  const before = await readFile(file, 'utf8');
  const tree = JSON.parse(before);
  if (find(tree, node => node.content?.mod === name)) return { file, changed: false };
  const row = find(tree, node => node.id === 'work-body' && node.type === 'row');
  if (!row) throw new Error('Expected the default workspace work-body row. Use a clone of the main layout.');
  let id = `${name}-sidebar`, suffix = 2;
  while (find(tree, node => node.id === id)) id = `${name}-sidebar-${suffix++}`;
  row.children.push({ id, type: 'block', size: { px: width }, min: 280, max: 640,
    content: { mod: name, props: { presentation: 'sidebar' } } });
  // Keep the personal file recoverable, and refuse an edit made since our read.
  const backup = `${file}.before-magpie-${Date.now()}`;
  await writeFile(backup, before, { flag: 'wx' });
  if (await readFile(file, 'utf8') !== before) throw new Error('The layout changed during installation. Retry after the edit has finished.');
  await writeFile(file, `${JSON.stringify(tree, null, 2)}\n`);
  return { file, backup, changed: true };
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
    console.log(result.changed ? `Added Magpie sidebar to ${result.file}\nPrevious file: ${result.backup}` : `Panel already exists in ${result.file}`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
