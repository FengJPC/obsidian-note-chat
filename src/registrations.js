import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {localDirectory} from './credentials.js';

export const NEW_ACCOUNT = '__new__';
export function registrationMetadata(value) {
  if (!value || typeof value.clientId !== 'string' || !value.clientId || ['dynamic_agent_client', NEW_ACCOUNT].includes(value.clientId) || typeof value.subject !== 'string' || !value.subject) throw new Error('应用登记信息不完整。');
  return {clientId: value.clientId, subject: value.subject, email: typeof value.email === 'string' ? value.email : '', name: typeof value.name === 'string' ? value.name : ''};
}
const digest = value => createHash('sha256').update(value).digest('hex');
async function readJSON(file) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return null; throw new Error('本机应用登记无法读取，请检查授权目录；不会自动创建新登记。'); }
}
async function writeJSON(file, value) {
  await fs.mkdir(path.dirname(file), {recursive: true, mode: 0o700});
  const temp = file + '.' + randomUUID() + '.tmp';
  try { await fs.writeFile(temp, JSON.stringify(value), {mode: 0o600}); await fs.rename(temp, file); }
  finally { await fs.unlink(temp).catch(() => {}); }
}
// One non-secret file per issued client avoids lost mappings when vaults write concurrently.
// Tokens remain in the separate, encrypted, vault-specific CredentialStore.
export class RegistrationStore {
  constructor(key, directory = localDirectory()) { this.key = key; this.directory = directory; }
  get accountsDirectory() { return path.join(this.directory, 'registrations'); }
  get selectionFile() { return path.join(this.directory, this.key + '.registration.json'); }
  accountFile(clientId) { return path.join(this.accountsDirectory, digest(clientId) + '.json'); }
  async read() {
    let files;
    try { files = await fs.readdir(this.accountsDirectory); }
    catch (e) { if (e.code !== 'ENOENT') throw e; files = []; }
    const accounts = [];
    for (const name of files.sort()) if (/^[a-f0-9]{64}\.json$/.test(name)) {
      const value = await readJSON(path.join(this.accountsDirectory, name));
      if (!value) continue;
      const item = registrationMetadata(value);
      if (digest(item.clientId) + '.json' !== name) throw new Error('应用登记与文件标识不匹配。');
      accounts.push(item);
    }
    const selected = (await readJSON(this.selectionFile))?.clientId;
    return {version: 1, accounts, selected: accounts.some(a => a.clientId === selected) ? selected : accounts[0]?.clientId || ''};
  }
  async remember(value) {
    const item = registrationMetadata(value), file = this.accountFile(item.clientId);
    const old = await readJSON(file);
    if (old && registrationMetadata(old).subject !== item.subject) throw new Error('应用登记与账号身份不匹配。');
    await writeJSON(file, item);
    await writeJSON(this.selectionFile, {clientId: item.clientId});
  }
}
export function chooseRegistration(registry, credential, selected) {
  const id = selected || credential?.clientId || registry.selected;
  if (credential && id !== credential.clientId) throw new Error('请先断开，再切换账号或工作区。');
  if (!id || id === NEW_ACCOUNT) return null;
  const item = registry.accounts.find(a => a.clientId === id);
  if (!item) throw new Error('所选应用登记不存在，请重新选择。');
  return registrationMetadata(item);
}
