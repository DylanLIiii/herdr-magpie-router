import { mkdir, readFile, writeFile, lstat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const source = fileURLToPath(new URL('../mods/magpie-dashboard/', import.meta.url));

/** Install the native sidebar mod; attach-panel adds its block to a personal workspace. */
export async function installPanel({ home = process.env.HERDR_APP_HOME || join(homedir(), '.config', 'herdr-app'), name = 'magpie-panel', endpoint = 'http://127.0.0.1:4317/api/dashboard', width = 368 } = {}) {
  if (!/^[a-z][a-z0-9-]{0,39}$/.test(name)) throw new Error('Panel name must start with a lowercase letter and contain only lowercase letters, digits and hyphens.');
  const url = new URL(endpoint);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/api/dashboard') {
    throw new Error('Endpoint must be the bridge HTTP(S) /api/dashboard URL, without credentials or query parameters.');
  }
  width = Number(width);
  if (!Number.isInteger(width) || width < 280 || width > 640) throw new Error('Panel width must be between 280 and 640 logical pixels.');
  const destination = join(resolve(home), 'mods', name);
  try {
    await lstat(destination);
    throw new Error(`Already exists: ${destination}. Choose another --name; existing files are never overwritten.`);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const main = await readFile(join(source, 'main.js'), 'utf8');
  const support = await Promise.all(['routing.js', 'live-routing.js', 'usage.js', 'connection.js'].map(async file => [file, await readFile(join(source, file), 'utf8')]));
  await mkdir(join(resolve(home), 'mods'), { recursive: true });
  await mkdir(destination); // Exclusive, including concurrent installers.
  await writeFile(join(destination, 'config.js'), `// Local bridge only. The Magpie service and its credential stay in the bridge .env.\nexport default ${JSON.stringify({ endpoint: url.href, modName: name, motion: true }, null, 2)};\n`, { flag: 'wx' });
  await writeFile(join(destination, 'mod.json'), `${JSON.stringify({ place: 'none', size: width, focusable: true }, null, 2)}\n`, { flag: 'wx' });
  for (const [file, content] of support) await writeFile(join(destination, file), content, { flag: 'wx' });
  await writeFile(join(destination, 'THIRD_PARTY_NOTICES.md'), await readFile(new URL('../THIRD_PARTY_NOTICES.md', import.meta.url)), { flag: 'wx' });
  // Write the entry last so the host sees a complete mod on first load.
  await writeFile(join(destination, 'main.js'), main, { flag: 'wx' });
  return { home: resolve(home), name, destination, width };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const options = {};
    for (let index = 2; index < process.argv.length; index += 2) {
      const key = { '--home': 'home', '--name': 'name', '--endpoint': 'endpoint', '--width': 'width' }[process.argv[index]];
      if (!key || !process.argv[index + 1]) throw new Error('Usage: node scripts/install-panel.js [--home DIR] [--name NAME] [--endpoint URL] [--width PX]');
      options[key] = process.argv[index + 1];
    }
    const result = await installPanel(options);
    console.log(`Installed right sidebar: ${result.destination} (${result.width}px)\nRun: herdr-app check ${JSON.stringify(result.destination)}\nFor the default workspace, run:\n  herdr-app do layout.clone --name main --as main-magpie\n  npm run attach:panel -- --home ${JSON.stringify(result.home)} --name ${result.name} --width ${result.width}\nShipped layouts are protected; the personal clone keeps the default workspace and adds Routing beside Files and Changes.`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
