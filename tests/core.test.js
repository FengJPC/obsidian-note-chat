import test from 'node:test';
import assert from 'node:assert/strict';
import {CALLBACK, AUTH, challenge, authorizationUrl, parseCallback, b64url, verifyIdToken, sseEvents} from '../src/shared/core.js';
test('PKCE S256 RFC 7636 vector and authorization scopes', async () => {
  assert.equal(await challenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  const u = new URL(authorizationUrl({state:'s', nonce:'n', challenge:'c'}, 'urn:uuid:host'));
  assert.equal(u.searchParams.get('redirect_uri'), CALLBACK);
  assert.equal(u.searchParams.get('client_id'), 'dynamic_agent_client');
  assert.ok(u.searchParams.get('scope').includes('chatgpt.tokens.use.direct'));
});
test('callback rejects wrong tab, state, expiry, duplicates and client replacement', () => {
  const p = {tabId: 7, state:'secret-state', created:1000};
  const u = CALLBACK + '?state=secret-state&code=one-use&client_id=oaiapp_test';
  assert.deepEqual(parseCallback(u, p, 7, 1100), {code:'one-use',clientId:'oaiapp_test'});
  assert.equal(parseCallback('https://example.com/auth/callback', p, 7, 1100), null);
  assert.throws(() => parseCallback(u, p, 8, 1100));
  assert.throws(() => parseCallback(u.replace('secret-state', 'wrong'), p, 7, 1100));
  assert.throws(() => parseCallback(u, p, 7, 700000));
  assert.throws(() => parseCallback(u+'&state=secret-state', p, 7, 1100));
  assert.throws(() => parseCallback(u, {...p,clientId:'oaiapp_other'}, 7, 1100));
  assert.throws(() => parseCallback(CALLBACK+'?state=secret-state&error=access_denied', p, 7, 1100));
});
test('ID token validates cryptographic signature, issuer, nonce, audience and expiration', async () => {
  const pair = await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
  const jwk = {...await crypto.subtle.exportKey('jwk', pair.publicKey),kid:'fixture'};
  const fetcher = async () => ({ok:true,json:async()=>({keys:[jwk]})});
  async function signed(p) {
    const parts = [b64url(new TextEncoder().encode(JSON.stringify({alg:'RS256',kid:'fixture'}))),b64url(new TextEncoder().encode(JSON.stringify(p)))];
    const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5',pair.privateKey,new TextEncoder().encode(parts.join('.')));
    return parts.join('.')+'.'+b64url(sig);
  }
  const p = {iss:AUTH,aud:'oaiapp_test',nonce:'n',exp:10000,sub:'user-fixture'};
  const token = await signed(p);
  assert.equal((await verifyIdToken(token,'oaiapp_test','n',fetcher,1000)).subject,'user-fixture');
  await assert.rejects(verifyIdToken(token,'wrong','n',fetcher,1000));
  await assert.rejects(verifyIdToken(token,'oaiapp_test','wrong',fetcher,1000));
  await assert.rejects(verifyIdToken(token,'oaiapp_test','n',fetcher,11000000));
  await assert.rejects(verifyIdToken(await signed({...p,iss:'https://evil.test'}),'oaiapp_test','n',fetcher,1000));
  await assert.rejects(verifyIdToken(token.slice(0,-4)+'AAAA','oaiapp_test','n',fetcher,1000));
});
test('SSE handles fragmented UTF8, CRLF, comments and completion', async () => {
  const text = ': ping\r\n\r\ndata: {"type":"response.output_text.delta","delta":"你好"}\r\n\r\ndata: {"type":"response.completed"}\n\ndata: [DONE]\n\n';
  const bytes = new TextEncoder().encode(text);
  const stream = new ReadableStream({start(c){for(let i=0;i<bytes.length;i+=3)c.enqueue(bytes.slice(i,i+3));c.close();}});
  const events = []; for await (const e of sseEvents(stream)) events.push(e);
  assert.equal(events[0].delta,'你好'); assert.equal(events.at(-1).type,'response.completed');
});
