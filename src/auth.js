import {canUseToken} from './shared/token-policy.js';
import http from 'node:http';
import {AUTH, API, SCOPE, randomToken, challenge, verifyIdToken, modelsFrom} from './shared/core.js';
import {chooseRegistration} from './registrations.js';

export function callbackResult(raw, pending) {
  const u = new URL(raw, pending.callback);
  if (u.origin !== new URL(pending.callback).origin || u.pathname !== '/auth/callback') throw new Error('回调地址不匹配。');
  for (const key of ['state', 'code', 'client_id', 'error']) if (u.searchParams.getAll(key).length > 1) throw new Error('登录回调参数重复。');
  if (u.searchParams.get('state') !== pending.state || Date.now() - pending.created > 600000) throw new Error('登录校验不匹配或已过期。');
  if (u.searchParams.has('error')) throw new Error('授权未完成：' + u.searchParams.get('error').slice(0, 80));
  const clientId = u.searchParams.get('client_id') || pending.clientId;
  if (!clientId || clientId === 'dynamic_agent_client' || pending.clientId && clientId !== pending.clientId) throw new Error('客户端身份不匹配。');
  const code = u.searchParams.get('code');
  if (!code) throw new Error('登录回调缺少授权码。');
  return {code, clientId};
}
export async function loopbackListener(pending, {timeoutMs = 600000, port = 0} = {}) {
  let settle, fail, consumed = false, timer;
  const finished = new Promise((resolve, reject) => { settle = resolve; fail = reject; });
  finished.catch(() => {});
  const server = http.createServer((req, res) => {
    const headers = {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'"};
    if (req.method !== 'GET' || (req.headers.host !== new URL(pending.callback).host)) { res.writeHead(400, headers); return res.end('Invalid callback request.'); }
    try {
      const result = callbackResult(req.url, pending);
      if (consumed) throw new Error('该回调已处理。');
      consumed = true;
      res.writeHead(200, headers); res.end('<!doctype html><meta charset="utf-8"><title>Note Chat</title><h2>已收到授权，请返回 Obsidian。</h2><p>账号验证结果会显示在伴读侧栏。可以关闭此页面。</p>');
      settle(result); clearTimeout(timer); server.close();
    } catch (e) {
      res.writeHead(400, headers); res.end('Authorization callback rejected. Return to Obsidian to retry.');
      // An unrelated request must not cancel a valid pending sign-in.
      if (req.url?.includes('error=') && new URL(req.url, pending.callback).searchParams.get('state') === pending.state) { clearTimeout(timer); server.close(); fail(e); }
    }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  pending.callback = `http://127.0.0.1:${server.address().port}/auth/callback`;
  const cancel = () => { clearTimeout(timer); server.close(); server.closeAllConnections?.(); fail(new Error('登录已取消。')); };
  timer = setTimeout(cancel, timeoutMs);
  return {finished, cancel, server};
}
export class Account {
  constructor({credentials, registrations, hostId, fetcher, open, onStatus = () => {}, verify = verifyIdToken}) {
    Object.assign(this, {credentials, registrations, hostId, fetcher, open, onStatus, verify}); this.epoch = 0;
  }
  async initialize() { this.record = await this.credentials.read(); if (this.record) await this.registrations.remember(this.record); }
  publicIdentity() { const r = this.record; return r ? {email: r.email, name: r.name, subject: r.subject} : null; }
  async publicRegistrations() { const registry = await this.registrations.read(); if (this.record) registry.selected = this.record.clientId; return registry; }
  async tokenRequest(fields) {
    const r = await this.fetcher(AUTH + '/api/accounts/oauth/token', {method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'}, body: new URLSearchParams(fields), signal: AbortSignal.timeout(30000)});
    if (!r.ok) throw new Error('授权接口返回 HTTP ' + r.status + '，请重新登录；请求不会自动重放。');
    const tokens = await r.json();
    if (!tokens.access_token || !tokens.refresh_token || !Number.isFinite(tokens.expires_in)) throw new Error('授权响应不完整。');
    if (tokens.scope === undefined && fields.grant_type === 'refresh_token') tokens.scope = this.record?.scope;
    if (!String(tokens.scope || '').split(' ').includes('chatgpt.tokens.use.direct')) throw new Error('账号未授权使用 ChatGPT 套餐。');
    return tokens;
  }
  async login(selected) {
    if (this.pending) throw new Error('登录正在进行；可先点击“取消登录”。');
    const epoch = ++this.epoch, old = this.record;
    const registry = await this.publicRegistrations();
    if (epoch !== this.epoch) return;
    const registration = chooseRegistration(registry, old, selected);
    const verifier = randomToken(), pending = {state: randomToken(), nonce: randomToken(), verifier, created: Date.now(), clientId: registration?.clientId};
    const proof = await challenge(verifier);
    if (epoch !== this.epoch) return;
    const listener = await loopbackListener(pending);
    if (epoch !== this.epoch) { listener.cancel(); return; }
    this.pending = listener;
    const u = new URL(AUTH + '/api/accounts/authorize');
    u.search = new URLSearchParams({client_id: pending.clientId || 'dynamic_agent_client', ...(registration ? {...(old?.idToken ? {id_token_hint: old.idToken} : {}), ...(registration.email ? {login_hint: registration.email} : {})} : {agent_name_hint: 'Note Chat for Obsidian'}), ext_agent_host_id: this.hostId, response_type: 'code', redirect_uri: pending.callback, scope: SCOPE, resource: API, state: pending.state, nonce: pending.nonce, code_challenge_method: 'S256', code_challenge: proof}).toString();
    this.onStatus('请在系统浏览器完成 ChatGPT 登录和授权。');
    this.completion = (async () => {
      try {
        const callback = await listener.finished;
        if (epoch !== this.epoch) return;
        this.onStatus('正在验证账号授权…');
        const tokens = await this.tokenRequest({grant_type: 'authorization_code', client_id: callback.clientId, code: callback.code, code_verifier: verifier, redirect_uri: pending.callback, resource: API});
        const identity = await this.verify(tokens.id_token, callback.clientId, pending.nonce, this.fetcher);
        if (epoch !== this.epoch) return;
        if (registration && registration.subject !== identity.subject) throw new Error('所选应用登记属于其他账号，请选择对应账号重新登录。');
        if (old && (old.subject !== identity.subject || old.clientId !== callback.clientId)) throw new Error('账号与原连接不一致，请先断开，再登录新账号。');
        const record = {...identity, clientId: callback.clientId, accessToken: tokens.access_token, refreshToken: tokens.refresh_token, idToken: tokens.id_token, scope: tokens.scope, expiresAt: Date.now() + tokens.expires_in * 1000, earliestRefreshAt: tokens.earliest_refresh_at || 0};
        await this.registrations.remember(record);
        if (epoch !== this.epoch) return;
        await this.credentials.write(record);
        if (epoch !== this.epoch) { await this.credentials.clear(); return; }
        this.record = record; this.onStatus('账号已连接，可以选择模型并聊天。');
      } catch (e) { if (epoch === this.epoch) this.onStatus('登录未完成：' + e.message); }
      finally { if (this.pending === listener) this.pending = null; }
    })();
    try { await this.open(u.href); } catch (e) { listener.cancel(); throw new Error('无法打开系统浏览器，请重试。'); }
  }
  async token() {
    const record = this.record, epoch = this.epoch;
    if (!record) throw new Error('请先连接 ChatGPT 账号。');
    if (canUseToken(record)) return record.accessToken;
    if (!this.renewing) this.renewing = (async () => {
      const next = await this.tokenRequest({grant_type: 'refresh_token', client_id: record.clientId, refresh_token: record.refreshToken, resource: API});
      if (epoch !== this.epoch || this.record !== record) throw new Error('账号已更改，已取消刷新。');
      const updated = {...record, accessToken: next.access_token, refreshToken: next.refresh_token, scope: next.scope, idToken: next.id_token || record.idToken, expiresAt: Date.now() + next.expires_in * 1000, earliestRefreshAt: next.earliest_refresh_at || 0};
      await this.credentials.write(updated);
      if (epoch !== this.epoch) { await this.credentials.clear(); throw new Error('账号已断开。'); }
      this.record = updated; return updated.accessToken;
    })().finally(() => { this.renewing = null; });
    return this.renewing;
  }
  async models() {
    const r = await this.fetcher(API + '/models', {headers: {Authorization: 'Bearer ' + await this.token()}, signal: AbortSignal.timeout(30000)});
    if (!r.ok) throw new Error('读取模型失败：HTTP ' + r.status);
    return modelsFrom(await r.json());
  }
  cancelLogin() { this.epoch++; this.pending?.cancel(); this.pending = null; this.onStatus('登录已取消。'); }
  async logout() { this.cancelLogin(); const old = this.record; this.record = null; try { if (old) await this.registrations.remember(old); } finally { await this.credentials.clear(); this.onStatus('已断开本机连接；可在 ChatGPT 设置中撤销应用授权。'); } }
  dispose() { this.epoch++; this.pending?.cancel(); this.pending = null; }
}
