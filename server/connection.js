import { readFile, mkdir, writeFile, rename, rm, lstat } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { DashboardSource, routeGroups, usageSummary } from './dashboard.js';

export class ConnectionError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

export function connectionPath(env = process.env) {
  return resolve(env.MAGPIE_CONNECTION_FILE || join(env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'herdr-magpie-router', 'connection.json'));
}

function address(value) {
  if (typeof value !== 'string' || value.length > 2048) throw new ConnectionError('Enter a Magpie Web service address.');
  let url;
  try { url = new URL(value.trim()); } catch { throw new ConnectionError('Use a full HTTP(S) address, including the Web port.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new ConnectionError('Use an HTTP(S) service origin without a path, query or embedded credentials.');
  }
  return url.origin;
}

function normalize(input, previous = null) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ConnectionError('Invalid connection settings.');
  const url = address(input.url);
  if (typeof input.key !== 'string' || typeof (input.cookiePort ?? '') !== 'string') throw new ConnectionError('Invalid key or cookie port.');
  const supplied = input.key.trim();
  // Blank means keep only when the secret's origin stays the same. Never send
  // the previous service's key to a different host, protocol or external port.
  const key = supplied || (previous?.url === url ? previous.key : '');
  if (!key) throw new ConnectionError(previous ? 'Enter a new Web key when changing the service address.' : 'Enter the Magpie Web access key.');
  if (!/^[A-Za-z0-9._~-]{16,4096}$/.test(key)) throw new ConnectionError('Use the Magpie Web access key (16–4096 URL-safe characters).');
  const port = (input.cookiePort || '').trim();
  if (port && (!/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535)) throw new ConnectionError('The internal Web port must be between 1 and 65535, or blank for automatic.');
  return { url, key, cookiePort: port ? String(Number(port)) : '' };
}

async function persist(file, record) {
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const existing = await lstat(file).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (existing && (!existing.isFile() || existing.isSymbolicLink())) throw new Error('Unsafe config destination');
  const temp = `${file}.${randomBytes(8).toString('hex')}.tmp`;
  try {
    await writeFile(temp, `${JSON.stringify({ version: 1, ...record }, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    await rename(temp, file);
  } finally { await rm(temp, { force: true }); }
}

/** One user-configured service per bridge. Secrets never leave this manager's
 * credential path except in an authenticated upstream request. */
export class Connections {
  #record = null;
  #factory;
  #saving = false;
  #stored = false;
  #notice = '';
  #listeners = new Set();
  #token = randomBytes(24).toString('hex');

  static async open({ env = process.env, file = connectionPath(env), fetchImpl = fetch, persistImpl = persist } = {}) {
    const manager = new Connections({ env, file, fetchImpl, persistImpl });
    let saved;
    try { saved = JSON.parse(await readFile(file, 'utf8')); }
    catch (error) {
      if (error.code !== 'ENOENT') manager.#notice = 'Saved settings could not be read. Enter the connection again.';
      return manager;
    }
    try {
      if (saved.version !== 1) throw new Error('Version');
      const record = normalize(saved);
      const source = manager.#factory(record);
      manager.#record = record; manager.source = source; manager.#stored = true; manager.#notice = '';
    } catch { manager.#notice = 'Saved settings are invalid. Enter the connection again.'; }
    return manager;
  }

  constructor({ env = {}, file, fetchImpl = fetch, persistImpl = persist } = {}) {
    this.file = file || connectionPath(env); this.revision = 0; this.persist = persistImpl;
    this.#factory = record => new DashboardSource({ env: { MAGPIE_WEB_URL: record.url, MAGPIE_WEB_KEY: record.key,
      MAGPIE_WEB_COOKIE_PORT: record.cookiePort }, fetchImpl });
    try {
      this.source = new DashboardSource({ env, fetchImpl });
      if (env.MAGPIE_WEB_URL) this.#record = normalize({ url: env.MAGPIE_WEB_URL, key: env.MAGPIE_WEB_KEY || '', cookiePort: env.MAGPIE_WEB_COOKIE_PORT || '' });
    } catch {
      this.source = new DashboardSource({ env: {}, fetchImpl });
      this.#notice = 'Environment settings are incomplete. Set the address and Web key here.';
    }
  }

  info() {
    return { url: this.#record?.url || '', cookiePort: this.#record?.cookiePort || '', hasKey: Boolean(this.#record?.key),
      configured: this.source.configured, revision: this.revision, saved: this.#stored,
      origin: this.#stored ? 'saved' : this.source.configured ? 'environment' : 'none', notice: this.#notice, token: this.#token };
  }
  authorizes(token) { return typeof token === 'string' && token === this.#token; }
  onChange(callback) { this.#listeners.add(callback); return () => this.#listeners.delete(callback); }
  candidate(input) {
    if (input?.revision !== this.revision) throw new ConnectionError('Connection settings changed. Reopen Connection and try again.', 409);
    const record = normalize(input, this.#record);
    return { record, source: this.#factory(record) };
  }
  async test(input) {
    const { record, source } = this.candidate(input);
    const results = await Promise.allSettled([
      source.trace({ after: 0 }),
      source.read('/api/groups').then(routeGroups),
      source.read('/api/usage?period=today').then(value => usageSummary(value, 'today')),
    ]);
    if (input.revision !== this.revision) throw new ConnectionError('Connection changed during the test. Reopen Connection.', 409);
    const checks = results.map((result, index) => ({ name: ['Routing', 'Groups', 'Usage'][index], ok: result.status === 'fulfilled' }));
    if (!checks.some(check => check.ok)) throw new ConnectionError('Cannot connect. Check the Web address, access key and internal port.', 502);
    return { url: record.url, ok: true, checks, partial: checks.some(check => !check.ok),
      routingActive: results[0].status === 'fulfilled' ? results[0].value.mine : false };
  }
  async save(input) {
    if (this.#saving) throw new ConnectionError('A connection save is already in progress. Try again.', 409);
    const { record, source } = this.candidate(input);
    this.#saving = true;
    try {
      try { await this.persist(this.file, record); }
      catch { throw new ConnectionError('Could not save local connection settings. The previous connection is unchanged.', 500); }
      this.#record = record; this.source = source; this.#stored = true; this.#notice = ''; this.revision++;
      for (const callback of this.#listeners) callback();
      return this.info();
    } finally { this.#saving = false; }
  }
}
