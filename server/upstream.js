const MAX_BYTES = 8 * 1024 * 1024;

export class SourceError extends Error {
  constructor(publicMessage, status = null) {
    super(publicMessage);
    this.publicMessage = publicMessage;
    this.status = status;
  }
}

/** Only fixed operator-controlled origins are accepted; upstream error bodies are never exposed. */
export function createReader({ baseUrl, headers = {}, fetchImpl = fetch, timeoutMs = 6000 }) {
  let base;
  try { base = new URL(baseUrl); }
  catch { throw new SourceError('MAGPIE_URL 格式无效'); }
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) {
    throw new SourceError('MAGPIE_URL 需要无内嵌凭据的 HTTP(S) 地址');
  }
  return async function read(path, { signal, timeout = timeoutMs } = {}) {
    const url = new URL(path, base);
    if (url.origin !== base.origin) throw new SourceError('拒绝访问其他上游地址');
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
