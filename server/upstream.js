const MAX_BYTES = 8 * 1024 * 1024;

export class SourceError extends Error {
  constructor(publicMessage, status = null) {
    super(publicMessage);
    this.publicMessage = publicMessage;
    this.status = status;
  }
}

/** A service may be mounted below an HTTP(S) reverse proxy path. */
export function serviceAddress(value) {
  let url;
  try { url = new URL(value); }
  catch { throw new SourceError('Use a full HTTP(S) service address.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new SourceError('Use an HTTP(S) address without a query, fragment or embedded credentials. A service path is allowed.');
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

/** Only the configured service prefix is read; upstream error bodies stay private. */
export function createReader({ baseUrl, headers = {}, fetchImpl = fetch, timeoutMs = 6000 }) {
  const base = new URL(`${serviceAddress(baseUrl)}/`);
  return async function read(path, { signal, timeout = timeoutMs } = {}) {
    if (typeof path !== 'string' || !/^\/(?!\/)/.test(path) || path.includes('\\')) throw new SourceError('拒绝访问其他上游地址');
    const url = new URL(path.slice(1), base);
    if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) throw new SourceError('拒绝访问其他上游地址');
    let response;
    try {
      const deadline = AbortSignal.timeout(Math.min(35000, Math.max(1, timeout)));
      response = await fetchImpl(url, { method: 'GET', headers: { Accept: 'application/json', ...headers }, signal: signal ? AbortSignal.any([signal, deadline]) : deadline, redirect: 'error' });
    } catch {
      throw new SourceError('Magpie 连接失败或超时，请检查服务地址');
    }
    if (!response.ok) {
      await response.body?.cancel();
      if ([401, 403].includes(response.status)) throw new SourceError('Magpie 认证失败，请检查本地凭据配置');
      if (response.status === 404) throw new SourceError('Magpie 接口不存在，请核对版本兼容性', 404);
      throw new SourceError(`Magpie 返回 HTTP ${response.status}`);
    }
    const chunks = [];
    let size = 0;
    try {
      for await (const chunk of response.body) {
        size += chunk.byteLength;
        if (size > MAX_BYTES) throw new SourceError('Magpie 返回数据过大，请缩小查询范围');
        chunks.push(Buffer.from(chunk));
      }
    } catch (error) {
      if (error instanceof SourceError) throw error;
      throw new SourceError('读取 Magpie 响应失败或超时');
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw new SourceError('Magpie 返回了无效 JSON，请核对服务地址'); }
  };
}
