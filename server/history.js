import { readdir, open } from 'node:fs/promises';
import { join } from 'node:path';

const MAX_FILE_BYTES = 4 * 1024 * 1024;

/** Read bounded tails only; skip partial/malformed lines and do not load request archives. */
export async function readHistory(directory, now = Date.now()) {
  if (!directory) return { routes: [], available: false };
  let files;
  try { files = await readdir(directory); }
  catch { return { routes: [], available: false }; }
  const firstDay = new Date(now - 86400000).toISOString().slice(0, 10);
  const filesToRead = files.filter(name => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(name) && name.slice(0, 10) >= firstDay).sort().slice(-3);
  const records = new Map();
  let truncated = false;
  for (const name of filesToRead) {
    let file;
    try {
      file = await open(join(directory, name), 'r');
      const stat = await file.stat();
      if (!stat.isFile()) continue;
      const start = Math.max(0, stat.size - MAX_FILE_BYTES);
      truncated ||= start > 0;
      const buffer = Buffer.alloc(Math.min(stat.size, MAX_FILE_BYTES));
      const { bytesRead } = await file.read(buffer, 0, buffer.length, start);
      let content = buffer.subarray(0, bytesRead).toString('utf8');
      if (start) content = content.slice(content.indexOf('\n') + 1);
      for (const line of content.split('\n')) {
        if (!line.trim()) continue;
        try {
          const route = JSON.parse(line);
          if (route && typeof route === 'object' && route.id != null) records.set(String(route.id), route);
        } catch { /* An active append may leave an incomplete last line; retry next poll. */ }
      }
    } catch { /* Rotation or missing permission on one file need not discard the others. */ }
    finally { await file?.close(); }
  }
  return { routes: [...records.values()].slice(-500), available: true, truncated };
}
