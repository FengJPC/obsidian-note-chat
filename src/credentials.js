import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash, randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';

export function vaultKey(basePath) {
  return createHash('sha256').update(path.resolve(basePath)).digest('hex');
}
export function localDirectory() {
  return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), '.local', 'share'), 'NoteChatObsidian');
}
const protectScript = `Add-Type -AssemblyName System.Security; $v=[Console]::In.ReadToEnd(); $b=[Convert]::FromBase64String($v); $r=[System.Security.Cryptography.ProtectedData]::Protect($b,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($r))`;
const unprotectScript = protectScript.replace('::Protect(', '::Unprotect(');
function dpapi(input, decrypt = false) {
  return new Promise((resolve, reject) => {
    const executable = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const child = spawn(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', decrypt ? unprotectScript : protectScript], {windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']});
    let output = ''; const timeout = setTimeout(() => { child.kill(); reject(new Error('系统凭据加密超时。')); }, 15000);
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.resume();
    child.on('error', () => { clearTimeout(timeout); reject(new Error('无法调用系统凭据加密。')); });
    child.on('close', code => { clearTimeout(timeout); if (code !== 0) return reject(new Error('无法解密本机授权，请重新登录。')); resolve(Buffer.from(output.trim(), 'base64')); });
    child.stdin.on('error', () => {});
    child.stdin.end(input.toString('base64'));
  });
}
export function systemProtector(electron) {
  const safe = electron.safeStorage || electron.remote?.safeStorage;
  if (safe?.isEncryptionAvailable() && safe.getSelectedStorageBackend?.() !== 'basic_text') {
    return {encrypt: async text => safe.encryptString(text), decrypt: async bytes => safe.decryptString(bytes)};
  }
  if (process.platform === 'win32') return {encrypt: async text => dpapi(Buffer.from(text, 'utf8')), decrypt: async bytes => (await dpapi(bytes, true)).toString('utf8')};
  throw new Error('此环境未提供可靠的系统凭据加密；第一版建议使用 Windows 桌面版。不会明文保存令牌。');
}
export class CredentialStore {
  constructor(key, protector, directory = localDirectory()) { this.key = key; this.protector = protector; this.directory = directory; }
  get filename() { return path.join(this.directory, this.key + '.credential'); }
  async read() {
    try { return JSON.parse(await this.protector.decrypt(await fs.readFile(this.filename))); }
    catch (e) { if (e.code === 'ENOENT') return null; throw new Error('本机授权无法读取或解密，请断开后重新登录。'); }
  }
  async write(value) {
    await fs.mkdir(this.directory, {recursive: true, mode: 0o700});
    const encrypted = await this.protector.encrypt(JSON.stringify(value));
    const temp = this.filename + '.' + randomUUID() + '.tmp';
    try { await fs.writeFile(temp, encrypted, {mode: 0o600}); await fs.rename(temp, this.filename); }
    finally { await fs.unlink(temp).catch(() => {}); }
  }
  async clear() { await fs.unlink(this.filename).catch(e => { if (e.code !== 'ENOENT') throw e; }); }
}
export async function hostIdentifier(directory = localDirectory()) {
  await fs.mkdir(directory, {recursive: true, mode: 0o700});
  const file = path.join(directory, 'host.json');
  try { return JSON.parse(await fs.readFile(file, 'utf8')).hostId; }
  catch (e) { if (e.code !== 'ENOENT') throw new Error('本机安装标识损坏，请检查本机授权目录。'); }
  const hostId = 'urn:uuid:' + randomUUID();
  try { await fs.writeFile(file, JSON.stringify({hostId}), {flag: 'wx', mode: 0o600}); return hostId; }
  catch (e) { if (e.code === 'EEXIST') return JSON.parse(await fs.readFile(file, 'utf8')).hostId; throw e; }
}
