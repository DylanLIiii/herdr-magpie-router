import { cp, mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const exists = path => access(path).then(() => true, () => false);

export async function installLayout({ home = process.env.HERDR_APP_HOME || join(homedir(), '.config', 'herdr-app'), name = 'magpie', endpoint = 'http://127.0.0.1:4317/api/dashboard' } = {}) {
  if (!/^[a-z][a-z0-9-]{0,39}$/.test(name)) throw new Error('Layout name must use lowercase letters, digits and hyphens, starting with a letter.');
  const url = new URL(endpoint);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/api/dashboard') {
    throw new Error('Endpoint must be the bridge HTTP(S) /api/dashboard URL, without credentials or query parameters.');
  }
  const destination = resolve(home);
  const targets = [join(destination, 'layouts', `${name}.json`), join(destination, 'layouts', `${name}.svg`),
    join(destination, 'mods', `${name}-dashboard`), join(destination, 'mods', `${name}-navigation`)];
  for (const path of targets) if (await exists(path)) throw new Error(`Already exists: ${path}. Choose another --name; existing files are never overwritten.`);
  const layout = JSON.parse(await readFile(join(root, 'layouts', 'magpie.json'), 'utf8'));
  layout.preview = `layouts/${name}.svg`;
  const walk = node => {
    if (node.content?.mod === 'magpie-dashboard') { node.content.mod = `${name}-dashboard`; node.content.props.endpoint = url.href; }
    if (node.content?.mod === 'magpie-navigation') node.content.mod = `${name}-navigation`;
    for (const child of node.children || []) walk(child);
  };
  walk(layout);
  await mkdir(join(destination, 'layouts'), { recursive: true });
  await mkdir(join(destination, 'mods'), { recursive: true });
  // Install mods before the layout so hot reload never sees missing mod files.
  for (const suffix of ['dashboard', 'navigation']) {
    const target = join(destination, 'mods', `${name}-${suffix}`);
    await mkdir(target); // exclusive: a concurrent install must never overwrite a mod
    for (const file of suffix === 'dashboard' ? ['main.js', 'routing.js', 'live-routing.js', 'usage.js', 'connection.js', 'presentation.js', 'icons'] : ['main.js']) {
      await cp(join(root, 'mods', `magpie-${suffix}`, file), join(target, file), { force: false, errorOnExist: true, recursive: true });
    }
    if (suffix === 'dashboard') {
      await writeFile(join(target, 'config.js'), `export default ${JSON.stringify({ endpoint: url.href, modName: `${name}-dashboard`, motion: true })};\n`, { flag: 'wx' });
      await writeFile(join(target, 'THIRD_PARTY_NOTICES.md'), await readFile(join(root, 'THIRD_PARTY_NOTICES.md')), { flag: 'wx' });
    }
    await writeFile(join(target, 'mod.json'), '{"place":"none","focusable":true}\n', { flag: 'wx' });
  }
  await writeFile(targets[1], await readFile(join(root, 'layouts', 'magpie.svg')), { flag: 'wx' });
  await writeFile(targets[0], `${JSON.stringify(layout, null, 2)}\n`, { flag: 'wx' });
  return { home: destination, name, targets };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const options = {};
  try {
    for (let index = 2; index < process.argv.length; index += 2) {
      const key = { '--home': 'home', '--name': 'name', '--endpoint': 'endpoint' }[process.argv[index]];
      if (!key || !process.argv[index + 1]) throw new Error('Usage: node scripts/install-layout.js [--home DIR] [--name NAME] [--endpoint URL]');
      options[key] = process.argv[index + 1];
    }
    const result = await installLayout(options);
    console.log(`Installed ${result.name} in ${result.home}\nCheck both mods with herdr-app check, then select the layout in Settings or run herdr-app do layout.switch --name ${result.name}`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
