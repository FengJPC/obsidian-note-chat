import https from 'node:https';
import {Readable} from 'node:stream';

// Only the fixed official authorization/API endpoints are accepted. Redirects
// are not followed, so bearer tokens cannot be forwarded to another host.
export function officialFetch(url, options = {}) {
  const u = new URL(url);
  if (u.protocol !== 'https:' || !['auth.openai.com', 'api.openai.com'].includes(u.hostname) || u.port && u.port !== '443') {
    throw new Error('拒绝向非官方端点发送授权或聊天请求。');
  }
  return new Promise((resolve, reject) => {
    const body = options.body == null ? undefined : String(options.body);
    const headers = {...options.headers};
    if (body != null) headers['Content-Length'] = Buffer.byteLength(body);
    const req = https.request(u, {method: options.method || 'GET', headers, signal: options.signal}, res => {
      const status = res.statusCode;
      resolve({status, ok: status >= 200 && status < 300, body: Readable.toWeb(res),
        async json() {
          const chunks = []; let size = 0;
          for await (const chunk of res) {
            size += chunk.length;
            if (size > 5_000_000) { res.destroy(); throw new Error('接口响应过大。'); }
            chunks.push(chunk);
          }
          return JSON.parse(Buffer.concat(chunks).toString('utf8'));
        }});
    });
    req.setTimeout(180000, () => req.destroy(new Error('连接连续 3 分钟无响应，已停止。')));
    req.on('error', reject);
    if (body != null) req.write(body);
    req.end();
  });
}
