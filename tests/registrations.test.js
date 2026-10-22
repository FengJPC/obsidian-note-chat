import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {Account} from '../src/auth.js';
import {RegistrationStore, NEW_ACCOUNT, chooseRegistration} from '../src/registrations.js';

const original = {clientId: 'oaiapp_original', subject: 'user-a', email: 'same@example.invalid', name: 'A', accessToken: 'FAKE_ACCESS', refreshToken: 'FAKE_REFRESH', idToken: 'FAKE_ID'};
async function fixtureDirectory(t) {
  const root = path.resolve(import.meta.dirname, '../artifacts');
  await fs.mkdir(root, {recursive: true});
  const directory = await fs.mkdtemp(path.join(root, 'registration-test-'));
  t.after(() => fs.rm(directory, {recursive: true, force: true}));
  return directory;
}
function credentials(initial = null) {
  let value = initial;
  return {read: async () => value, write: async r => {value = structuredClone(r);}, clear: async () => {value = null;}};
}
test('registration metadata persists outside vaults without tokens; concurrent vault writes do not lose clients', async t => {
  const directory = await fixtureDirectory(t), a = new RegistrationStore('vault-A', directory), b = new RegistrationStore('vault-B', directory);
  await Promise.all([a.remember(original), b.remember({...original, clientId: 'oaiapp_other', subject: 'user-b'})]);
  const ra = await a.read(), rb = await b.read();
  assert.equal(ra.accounts.length, 2); assert.equal(rb.accounts.length, 2);
  assert.equal(ra.selected, 'oaiapp_original'); assert.equal(rb.selected, 'oaiapp_other');
  assert.equal(new Set(ra.accounts.map(a => a.email)).size, 1);
  for (const name of await fs.readdir(a.accountsDirectory)) {
    const text = await fs.readFile(path.join(a.accountsDirectory, name), 'utf8');
    assert.ok(!text.includes('FAKE_')); assert.ok(!text.includes('Token'));
  }
  await assert.rejects(a.remember({...original, subject: 'impostor'}), /不匹配/);
  assert.throws(() => chooseRegistration(ra, null, 'missing'), /不存在/);
  assert.throws(() => chooseRegistration(ra, original, NEW_ACCOUNT), /先断开/);
  await fs.writeFile(a.accountFile(original.clientId), '{bad-json');
  await assert.rejects(a.read(), /不会自动创建/);
});
test('legacy migration, repeated logout/restart and another vault reuse the issued client via real loopback callbacks', async t => {
  const directory = await fixtureDirectory(t), saved = credentials(original);
  let opened, identity = 'user-a', exchanges = 0;
  const statuses = [];
  const create = (key, store) => new Account({credentials: store, registrations: new RegistrationStore(key, directory), hostId: 'urn:uuid:same-host', open: async u => {opened = new URL(u);}, onStatus: s => statuses.push(s), verify: async () => ({subject: identity, email: original.email}), fetcher: async (url, options) => {
    assert.ok(new URLSearchParams(options.body).get('client_id').startsWith('oaiapp_')); exchanges++;
    return {ok: true, json: async () => ({access_token: 'FAKE_ACCESS', refresh_token: 'FAKE_REFRESH', id_token: 'FAKE_ID', scope: 'chatgpt.tokens.use.direct', expires_in: 3600})};
  }});
  const accounts = []; t.after(() => accounts.forEach(a => a.dispose()));
  async function finish(account, client = 'oaiapp_original') {
    const callback = new URL(opened.searchParams.get('redirect_uri'));
    callback.search = new URLSearchParams({state: opened.searchParams.get('state'), code: 'synthetic-code', client_id: client});
    assert.equal((await fetch(callback)).status, 200); await account.completion;
  }
  let account = create('vault-A', saved); accounts.push(account); await account.initialize();
  assert.equal((await account.publicRegistrations()).accounts.length, 1);
  const attempts = [];
  for (let n = 0; n < 3; n++) {
    await account.logout(); assert.equal(await saved.read(), null);
    account.dispose(); account = create('vault-A', saved); accounts.push(account); await account.initialize();
    await account.login();
    assert.equal(opened.searchParams.get('client_id'), 'oaiapp_original');
    assert.equal(opened.searchParams.get('ext_agent_host_id'), 'urn:uuid:same-host');
    assert.equal(opened.searchParams.get('login_hint'), original.email);
    assert.equal(opened.searchParams.has('id_token_hint'), false);
    assert.equal(opened.searchParams.has('agent_name_hint'), false);
    attempts.push(['state', 'nonce', 'code_challenge'].map(k => opened.searchParams.get(k)));
    await finish(account); assert.equal(account.record.clientId, 'oaiapp_original');
    assert.equal((await account.publicRegistrations()).accounts.length, 1);
  }
  for (let i = 0; i < 3; i++) assert.equal(new Set(attempts.map(a => a[i])).size, 3);
  const otherCredentials = credentials(), other = create('vault-B', otherCredentials); accounts.push(other); await other.initialize();
  assert.equal(other.publicIdentity(), null); assert.equal(await otherCredentials.read(), null);
  await other.login(); assert.equal(opened.searchParams.get('client_id'), 'oaiapp_original');
  identity = 'user-b'; await finish(other);
  assert.equal(await otherCredentials.read(), null); assert.match(statuses.at(-1), /属于其他账号/);
  await other.login(NEW_ACCOUNT); assert.equal(opened.searchParams.get('client_id'), 'dynamic_agent_client');
  assert.equal(opened.searchParams.get('agent_name_hint'), 'Note Chat for Obsidian');
  assert.equal(opened.searchParams.has('login_hint'), false);
  await finish(other, 'oaiapp_b'); assert.equal(other.record.subject, 'user-b');
  assert.equal((await other.publicRegistrations()).accounts.length, 2);
  assert.equal((await saved.read()).subject, 'user-a'); // No sharing or clearing A's tokens.
  await other.logout(); assert.equal(await otherCredentials.read(), null);
  assert.equal((await other.publicRegistrations()).selected, 'oaiapp_b');
  await assert.rejects(other.login('missing'), /不存在/); assert.equal(other.pending, null);
  await other.login('oaiapp_original'); identity = 'user-a'; await finish(other);
  assert.equal(other.record.subject, 'user-a'); assert.equal(exchanges, 6);
  assert.ok(!JSON.stringify(await other.publicRegistrations()).includes('FAKE_'));
});
test('logout still clears vault tokens when registration storage fails', async () => {
  const store = credentials(original);
  const account = new Account({credentials: store, registrations: {remember: async () => {throw new Error('storage-failure');}}});
  account.record = original;
  await assert.rejects(account.logout(), /storage-failure/);
  assert.equal(account.record, null); assert.equal(await store.read(), null);
});
test('cancel during registration lookup prevents opening a listener or browser', async () => {
  let release, opened = false;
  const barrier = new Promise(resolve => {release = resolve;});
  const account = new Account({credentials: credentials(), registrations: {read: () => barrier}, open: async () => {opened = true;}});
  const login = account.login(); account.cancelLogin(); release({accounts: [], selected: ''}); await login;
  assert.equal(opened, false); assert.equal(account.pending, null);
});
