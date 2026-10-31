import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createReader } from '../server/upstream.js';

test('credentials stay server-side and redirects are forbidden', async () => {
  let observed;
  const read = createReader({ baseUrl: 'http://localhost:3425', headers: { Authorization: 'Bearer test-only-key' }, fetchImpl: async (url, options) => {
    observed = { url, options };
    return new Response('{"ok":true}');
  } });
  assert.deepEqual(await read('/api/status'), { ok: true });
  assert.equal(observed.options.headers.Authorization, 'Bearer test-only-key');
  assert.equal(observed.options.redirect, 'error');
  assert.equal(observed.options.method, 'GET');
  await assert.rejects(read('//attacker.example/steal'), /其他上游/);
});

test('upstream errors never disclose bodies or credentials', async () => {
  const read = createReader({ baseUrl: 'http://localhost:3425', fetchImpl: async () => new Response('secret-test-value', { status: 401 }) });
  await assert.rejects(read('/api/status'), error => {
    assert.match(error.publicMessage, /认证失败/);
    assert.doesNotMatch(error.publicMessage, /secret-test-value/);
    return true;
  });
});

test('reject inline credentials, invalid schemas, invalid JSON and broken network', async () => {
  for (const baseUrl of ['file:///etc/passwd', 'http://key:secret@localhost', 'http://localhost/?token=secret', 'not-a-url']) {
    assert.throws(() => createReader({ baseUrl }));
  }
  const invalid = createReader({ baseUrl: 'http://localhost', fetchImpl: async () => new Response('<html>login</html>') });
  await assert.rejects(invalid('/api/status'), /无效 JSON/);
  const failed = createReader({ baseUrl: 'http://localhost', fetchImpl: async () => { throw new Error('sensitive-url'); } });
  await assert.rejects(failed('/api/status'), error => !error.message.includes('sensitive-url'));
});
