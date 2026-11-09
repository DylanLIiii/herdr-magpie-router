import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installLayout } from '../scripts/install-layout.js';

test('layout installer preserves personal settings and refuses collisions before changing files', async t => {
  const home = await mkdtemp(join(tmpdir(), 'magpie-layout-install-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  await writeFile(join(home, 'settings.json'), '{"zoom":1.2}');
  await writeFile(join(home, 'keys.json'), '{"global":{"ctrl-1":"terminal"}}');
  const result = await installLayout({ home, name: 'my-magpie', endpoint: 'http://127.0.0.1:14317/api/dashboard' });
  const layout = JSON.parse(await readFile(result.targets[0], 'utf8'));
  assert.equal(layout.preview, 'layouts/my-magpie.svg');
  assert.equal(layout.children[0].content.mod, 'my-magpie-navigation');
  const dashboard = layout.children[1].children[1].content;
  assert.equal(dashboard.mod, 'my-magpie-dashboard');
  assert.equal(dashboard.props.endpoint, 'http://127.0.0.1:14317/api/dashboard');
  assert.equal(await readFile(join(home, 'settings.json'), 'utf8'), '{"zoom":1.2}');
  assert.equal(await readFile(join(home, 'keys.json'), 'utf8'), '{"global":{"ctrl-1":"terminal"}}');
  const before = await readFile(result.targets[0], 'utf8');
  await assert.rejects(installLayout({ home, name: 'my-magpie' }), /Already exists/);
  assert.equal(await readFile(result.targets[0], 'utf8'), before);
  await assert.rejects(installLayout({ home, name: '../unsafe' }), /Layout name/);
});
