// Only known protocol codes may reach the UI/storage. Never retain response text,
// error descriptions, request fields, account identifiers or credentials.
const terminal = new Set(['invalid_grant','invalid_refresh_token','token_expired','refresh_token_expired','refresh_token_invalidated','refresh_token_reused']);
const known = new Set([...terminal,'invalid_client','invalid_request','invalid_scope','unauthorized_client','unsupported_grant_type','access_denied','temporarily_unavailable','server_error','refresh_too_early','refresh_token_too_early']);
async function errorBody(response) {
  const reader = response.body?.getReader();
  if (!reader) return null;
  const decoder = new TextDecoder(); let text = '', size = 0;
  try {
    while (true) {
      const {done,value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 16384) return null;
      text += decoder.decode(value,{stream:true});
    }
    return JSON.parse(text + decoder.decode());
  } catch { return null; }
  finally { await reader.cancel().catch(()=>{}); reader.releaseLock(); }
}
export async function authorizationError(response, grant) {
  const body = await errorBody(response);
  const raw = typeof body?.error === 'string' ? body.error : body?.error?.code;
  const code = known.has(raw) ? raw : 'unrecognized_error';
  const phase = grant === 'refresh_token' ? 'refresh' : 'code_exchange';
  const unusable = phase === 'refresh' && [400,401].includes(response.status) && terminal.has(code);
  const advice = unusable ? '刷新凭据已失效，请在设置中重新登录已有账号。'
    : code === 'invalid_client' ? '应用登记被拒绝，请检查客户端配置；不会自动新建登记。'
    : phase === 'code_exchange' && code === 'invalid_grant' ? '本次登录授权码无效或已过期，请重新发起登录。'
    : code.includes('too_early') ? '服务端暂未允许刷新，请稍后再试。'
    : response.status === 429 || response.status >= 500 ? '授权服务暂时不可用，已保留连接，请稍后再试。'
    : '授权请求被拒绝，现有连接未清除；请查看授权诊断。';
  const message = (phase === 'refresh' ? '刷新授权失败' : '登录换码失败') + '：HTTP ' + response.status + '（' + code + '）。' + advice;
  const error = new Error(message);
  error.unusable = unusable;
  error.diagnostic = {at:new Date().toISOString(),phase,httpStatus:response.status,code};
  return error;
}
