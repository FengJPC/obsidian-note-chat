import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {loopbackListener, callbackResult, Account} from '../src/auth.js';
import {CredentialStore, systemProtector, vaultKey, hostIdentifier} from '../src/credentials.js';
import {saveExport, exportFolder} from '../src/vault-files.js';
import {officialFetch} from '../src/network.js';
import {registrationMetadata} from '../src/registrations.js';

function memoryRegistrations() {
  const registry = {accounts: [], selected: ''};
  return {read: async () => structuredClone(registry), remember: async value => {const item = registrationMetadata(value); registry.accounts = registry.accounts.filter(a => a.clientId !== item.clientId).concat(item); registry.selected = item.clientId;}};
}

test('real loopback callback: wrong state and duplicate fields do not consume the attempt', async () => {
  const pending = {state: 'private-state', created: Date.now()};
  const listener = await loopbackListener(pending, {timeoutMs: 5000});
  try {
    const wrong = await fetch(pending.callback + '?state=wrong&code=c&client_id=oaiapp_test');
    assert.equal(wrong.status, 400);
    assert.equal((await fetch(pending.callback + '?state=private-state&state=private-state&code=c&client_id=oaiapp_test')).status, 400);
    const valid = await fetch(pending.callback + '?state=private-state&code=c&client_id=oaiapp_test');
    assert.equal(valid.status, 200); assert.ok(!(await valid.text()).includes('private-state'));
    assert.deepEqual(await listener.finished, {code: 'c', clientId: 'oaiapp_test'});
    assert.equal(listener.server.address(), null);
  } finally { listener.cancel(); }
});
test('callback cancellation and access_denied close the listener', async () => {
  const p = {state: 's', created: Date.now()}; const listener = await loopbackListener(p);
  await fetch(p.callback + '?state=s&error=access_denied');
  await assert.rejects(listener.finished, /授权未完成/);
  const l2 = await loopbackListener({state: 's', created: Date.now()}); l2.cancel();
  await assert.rejects(l2.finished, /取消/);
  assert.equal(l2.server.address(), null);
  assert.throws(() => callbackResult('http://example.com/auth/callback?state=s', p));
});
test('desktop account first login and refresh retain issued client and do not leak secrets into public identity', async () => {
  let saved, opened, exchanges = 0; const statuses = [];
  const store = {read: async () => saved || null, write: async r => { saved = r; }, clear: async () => { saved = null; }};
  const account = new Account({credentials: store, registrations: memoryRegistrations(), hostId: 'urn:uuid:test', open: async url => { opened = new URL(url); }, onStatus: s => statuses.push(s), verify: async () => ({subject: 'fixture', email: 'fixture@example.invalid', name: 'Test'}), fetcher: async (url, options) => {
    const form = new URLSearchParams(options.body); assert.equal(form.get('client_id'), 'oaiapp_fixture'); exchanges++;
    return {ok: true, json: async () => ({access_token: 'fake-access-' + exchanges, refresh_token: 'fake-refresh-' + exchanges, id_token: 'fake-id', expires_in: 3600, scope: 'chatgpt.tokens.use.direct'})};
  }});
  await account.initialize(); await account.login();
  assert.equal(opened.searchParams.get('client_id'), 'dynamic_agent_client');
  assert.equal(opened.searchParams.get('agent_name_hint'), 'Note Chat for Obsidian');
  const callback = opened.searchParams.get('redirect_uri');
  await fetch(callback + '?state=' + opened.searchParams.get('state') + '&code=one&client_id=oaiapp_fixture');
  await account.completion;
  assert.equal(saved.clientId, 'oaiapp_fixture'); assert.equal(exchanges, 1);
  assert.ok(!JSON.stringify(account.publicIdentity()).includes('fake-access'));
  account.record.expiresAt = 0; await Promise.all([account.token(), account.token()]);
  assert.equal(exchanges, 2); assert.equal(saved.accessToken, 'fake-access-2');
  await account.login(); assert.equal(opened.searchParams.get('client_id'), 'oaiapp_fixture');
  assert.equal(opened.searchParams.get('id_token_hint'), 'fake-id');
  await account.logout(); await account.completion;
  assert.equal(account.publicIdentity(), null); assert.equal(saved, null);
  assert.equal(exchanges, 2); account.dispose();
});
test('logout while exchanging an authorization code cannot resurrect the account', async () => {
  let opened, release, saved; const barrier = new Promise(r => { release = r; });
  const account = new Account({credentials: {read: async () => null, write: async r => { saved = r; }, clear: async () => { saved = null; }}, registrations: memoryRegistrations(), hostId: 'test', open: async u => { opened = new URL(u); }, verify: async () => ({subject: 'fixture'}), fetcher: async () => { await barrier; return {ok: true, json: async () => ({access_token: 'fake', refresh_token: 'fake', id_token: 'fake', expires_in: 3600, scope: 'chatgpt.tokens.use.direct'})}; }});
  await account.initialize(); await account.login();
  await fetch(opened.searchParams.get('redirect_uri') + '?state=' + opened.searchParams.get('state') + '&code=c&client_id=oaiapp_test');
  await account.logout(); release(); await account.completion;
  assert.equal(saved, null); assert.equal(account.record, null);
});
test('vault separation, stable host and real Windows system encryption', {skip: process.platform !== 'win32'}, async () => {
  const testRoot = path.resolve(import.meta.dirname, '../artifacts');
  await fs.mkdir(testRoot, {recursive: true});
  const dir = await fs.mkdtemp(path.join(testRoot, 'credential-test-'));
  try {
    const a = new CredentialStore(vaultKey('/vault-A'), systemProtector({}), dir);
    const b = new CredentialStore(vaultKey('/vault-B'), systemProtector({}), dir);
    await a.write({accessToken: 'FAKE_TEST_TOKEN_DO_NOT_USE'});
    const encrypted = await fs.readFile(a.filename);
    assert.ok(!encrypted.includes(Buffer.from('FAKE_TEST_TOKEN_DO_NOT_USE')));
    assert.deepEqual(await a.read(), {accessToken: 'FAKE_TEST_TOKEN_DO_NOT_USE'}); assert.equal(await b.read(), null);
    assert.equal(await hostIdentifier(dir), await hostIdentifier(dir));
    await a.clear(); assert.equal(await a.read(), null);
  } finally { await fs.rm(dir, {recursive: true, force: true}); }
});
test('export folder rejects escape/config paths and saves same names without overwriting', async () => {
  for (const value of ['../outside', '/absolute', '.obsidian/plugins', 'notes/../outside', 'notes//bad', 'C:\\Users', 'notes/CON']) assert.throws(() => exportFolder(value));
  const files = new Map();
  const vault = {getAbstractFileByPath: p => files.get(p), createFolder: async p => { files.set(p, {folder: true}); }, create: async (p, text) => { if (files.has(p)) throw new Error('exists'); files.set(p, {text}); }};
  const first = await saveExport(vault, 'AI 对话', 'test.md', 'one');
  const next = await saveExport(vault, 'AI 对话', 'test.md', 'two');
  assert.notEqual(first, next); assert.equal(files.get(first).text, 'one'); assert.equal(files.get(next).text, 'two');
  await assert.rejects(saveExport(vault, 'AI 对话', 'script.exe', 'x'));
});
test('official network client rejects foreign hosts and plaintext before network work', () => {
  assert.throws(() => officialFetch('https://evil.example/api'));
  assert.throws(() => officialFetch('http://api.openai.com/v1/responses'));
});
test('refresh preserves granted scopes when omitted and respects earliest refresh time', async () => {
  let calls = 0;
  const account = new Account({credentials: {write: async () => {}}, fetcher: async () => { calls++; return {ok: true, json: async () => ({access_token: 'next', refresh_token: 'next-refresh', expires_in: 3600})}; }});
  account.record = {clientId: 'oaiapp_fixture', accessToken: 'current', refreshToken: 'refresh', scope: 'chatgpt.tokens.use.direct', expiresAt: Date.now() + 1000, earliestRefreshAt: Math.floor(Date.now() / 1000) + 30};
  assert.equal(await account.token(), 'current'); assert.equal(calls, 0);
  account.record.expiresAt = 0; await assert.rejects(account.token(), /暂未允许刷新/);
  account.record.earliestRefreshAt = 0; assert.equal(await account.token(), 'next');
  assert.equal(account.record.scope, 'chatgpt.tokens.use.direct'); assert.equal(calls, 1);
});
