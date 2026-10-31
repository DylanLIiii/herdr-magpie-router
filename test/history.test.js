import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readHistory } from '../server/history.js';

test('history tolerates concurrent partial append and merges duplicate request updates', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'magpie-router-history-'));
  try {
    await writeFile(join(directory, '2026-10-31.jsonl'), '{"id":1,"done":false}\ninvalid\n{"id":1,"done":true}\n{"id":2');
    await writeFile(join(directory, '2026-01-01.jsonl'), '{"id":99}\n');
    await writeFile(join(directory, 'unrelated.json'), '{"id":88}');
    const data = await readHistory(directory, Date.parse('2026-10-31T12:00:00Z'));
    assert.equal(data.available, true);
    assert.deepEqual(data.routes, [{ id: 1, done: true }]);
  } finally { await rm(directory, { recursive: true }); }
});

test('disabled or missing history is distinct from an empty valid directory', async () => {
  assert.equal((await readHistory('')).available, false);
  assert.equal((await readHistory('/path-that-does-not-exist/magpie')).available, false);
});
