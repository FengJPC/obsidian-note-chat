export const AUTH = 'https://auth.openai.com';
export const API = 'https://api.openai.com/v1';
export const CALLBACK = 'http://127.0.0.1:1455/auth/callback';
export const SCOPE = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
export function b64url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function randomToken() { return b64url(crypto.getRandomValues(new Uint8Array(32))); }
export async function challenge(verifier) { return b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))); }
export function authorizationUrl(pending, hostId) {
  const url = new URL(AUTH + '/api/accounts/authorize');
  url.search = new URLSearchParams({client_id: pending.clientId || 'dynamic_agent_client',
    ...(pending.clientId ? {} : {agent_name_hint: 'Edge GPT Sidebar'}),
    ext_agent_host_id: hostId, response_type: 'code', redirect_uri: CALLBACK,
    scope: SCOPE, resource: API, state: pending.state, nonce: pending.nonce,
    code_challenge_method: 'S256', code_challenge: pending.challenge}).toString();
  return url.href;
}
export function parseCallback(url, pending, tabId, now = Date.now()) {
  const u = new URL(url), expected = new URL(CALLBACK);
  if (u.origin !== expected.origin || u.pathname !== expected.pathname) return null;
  if (!pending || pending.tabId !== tabId || now - pending.created > 10 * 60 * 1000) throw new Error('登录尝试已过期，或返回了其他标签页。请重新登录。');
  for (const key of ['state', 'code', 'client_id', 'error']) if (u.searchParams.getAll(key).length > 1) throw new Error('登录回调参数重复。');
  if (u.searchParams.get('state') !== pending.state) throw new Error('登录校验不匹配，已拒绝回调。');
  if (u.searchParams.has('error')) throw new Error('授权没有完成：' + u.searchParams.get('error').slice(0, 100));
  const clientId = u.searchParams.get('client_id') || pending.clientId;
  if (!clientId || clientId === 'dynamic_agent_client') throw new Error('OpenAI 未返回正式客户端编号。');
  if (pending.clientId && clientId !== pending.clientId) throw new Error('登录客户端编号发生变化。');
  const code = u.searchParams.get('code');
  if (!code) throw new Error('登录回调缺少授权码。');
  return {code, clientId};
}
function decodePart(part) {
  const raw = part.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(raw + '='.repeat((4 - raw.length % 4) % 4)), c => c.charCodeAt(0));
}
export async function verifyIdToken(token, clientId, nonce, fetcher = fetch, now = Date.now()) {
  const parts = token?.split('.');
  if (parts?.length !== 3) throw new Error('登录身份凭据格式不正确。');
  const header = JSON.parse(new TextDecoder().decode(decodePart(parts[0])));
  const payload = JSON.parse(new TextDecoder().decode(decodePart(parts[1])));
  if (header.alg !== 'RS256' || !header.kid) throw new Error('登录身份签名算法不受支持。');
  const response = await fetcher(AUTH + '/.well-known/jwks.json');
  if (!response.ok) throw new Error('无法取得官方身份验证公钥。');
  const keys = (await response.json()).keys;
  const jwk = keys?.find(k => k.kid === header.kid && k.kty === 'RSA' && (!k.use || k.use === 'sig'));
  if (!jwk) throw new Error('没有找到身份凭据对应的官方公钥。');
  const key = await crypto.subtle.importKey('jwk', jwk, {name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256'}, false, ['verify']);
  const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, decodePart(parts[2]), new TextEncoder().encode(parts[0] + '.' + parts[1]));
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!valid || payload.iss !== AUTH || !aud.includes(clientId) || (aud.length > 1 && payload.azp !== clientId) || !Number.isFinite(payload.exp) || payload.exp * 1000 <= now || (payload.nbf && payload.nbf * 1000 > now + 30000) || payload.nonce !== nonce || !payload.sub) throw new Error('登录身份签名或身份校验失败。');
  return {subject: payload.sub, email: payload.email || '', name: payload.name || ''};
}
export function modelsFrom(body) {
  return (body.models || body.data || []).filter(m => !m.visibility || m.visibility === 'list').map(m => ({id: m.slug || m.id, name: m.display_name || m.slug || m.id, efforts:(m.supported_reasoning_levels||m.supported_reasoning_efforts||[]).map(e=>typeof e==='string'?e:e.effort).filter(Boolean)})).filter(m => m.id);
}
export async function* sseEvents(stream) {
  const reader = stream.getReader(), decoder = new TextDecoder(); let buffer = '';
  try {
    while (true) {
      const {done, value} = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, {stream: true});
      let match;
      while ((match = /\r?\n\r?\n/.exec(buffer))) {
        const block = buffer.slice(0, match.index); buffer = buffer.slice(match.index + match[0].length);
        const data = block.split(/\r?\n/).filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart()).join('\n');
        if (data && data !== '[DONE]') yield JSON.parse(data);
      }
      if (done) break;
    }
  } finally { await reader.cancel().catch(()=>{}); reader.releaseLock(); }
}
