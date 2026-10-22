import {Plugin, ItemView, PluginSettingTab, Setting, MarkdownView, Notice, TFile, Menu} from 'obsidian';
import {shell, clipboard} from 'electron';
import * as electron from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import {Account} from './auth.js';
import {CredentialStore, systemProtector, vaultKey, hostIdentifier} from './credentials.js';
import {RegistrationStore} from './registrations.js';
import {officialFetch} from './network.js';
import {chatAction} from './shared/chats.js';
import {API} from './shared/core.js';
import {saveExport, exportFolder} from './vault-files.js';
import {uiDocument} from './ui-document.js';
import {readingContextMenu} from './selection-menu.js';

const VIEW = 'note-chat-sidebar-view';
const ALLOWED_KEYS = new Set(['chatStore', 'uiPrefs', 'modelCatalog', 'selectedModel', 'selectionDraft', 'chatHistory', 'composer', 'composerSource']);
export default class NoteChatPlugin extends Plugin {
  async onload() {
    this.views = new Set(); this.queue = Promise.resolve(); this.requests = new Map(); this.pumps = new Map(); this.stoppedRequests = new Set();
    this.authStatus = '请连接 ChatGPT 账号。'; this.data = await this.loadData() || {}; this.exportDirectory = this.data.exportDirectory || 'AI 对话';
    this.basePath = this.app.vault.adapter.getBasePath?.();
    if (!this.basePath) { new Notice('伴读侧栏需要桌面版的本地笔记库。'); return; }
    this.pluginDirectory = path.join(this.basePath, this.manifest.dir || this.app.vault.configDir + '/plugins/' + this.manifest.id);
    try {
      const realBase = await fs.realpath(this.basePath);
      this.account = new Account({credentials: new CredentialStore(vaultKey(realBase), systemProtector(electron)), registrations: new RegistrationStore(vaultKey(realBase)), hostId: await hostIdentifier(), fetcher: officialFetch, open: url => shell.openExternal(url), onStatus: status => { this.authStatus = status; this.broadcast({type: 'storageChanged', changes: {credential: {newValue: this.account.publicIdentity()}, authStatus: {newValue: status}}, area: 'local'}); }});
      await this.account.initialize();
      if (this.account.record) this.authStatus = '账号已连接，可以选择模型并聊天。';
    } catch (e) { this.authStatus = e.message; }
    this.storage = {get: keys => this.getStorage(keys), set: values => this.setStorage(values), remove: keys => this.removeStorage(keys)};
    this.registerView(VIEW, leaf => new ChatView(leaf, this));
    this.addRibbonIcon('messages-square', '打开伴读侧栏', () => this.activate());
    this.addCommand({id: 'open-sidebar', name: '打开伴读侧栏', callback: () => this.activate()});
    this.addCommand({id: 'send-selection', name: '将选文放入聊天草稿', editorCallback: (editor, view) => this.stageSelection(editor, view.file)});
    this.addCommand({id: 'read-current-note', name: '将当前笔记放入聊天草稿', callback: () => this.stageNote()});
    this.addSettingTab(new NoteChatSettings(this.app, this));
    this.trackNote();
    this.registerEvent(this.app.workspace.on('active-leaf-change', () => this.trackNote()));
    this.registerSelectionMenus();
    this.registerEvent(this.app.workspace.on('file-menu', (menu, file) => {
      if (!(file instanceof TFile) || !['md', 'pdf'].includes(file.extension)) return;
      menu.addItem(item => item.setTitle('添加到伴读侧栏（草稿）').setIcon('messages-square').onClick(() => this.stageNote(file)));
    }));
  }
  registerSelectionMenus() {
    this.registerEvent(this.app.workspace.on('editor-menu', (menu, editor, view) => {
      const text = editor.getSelection().trim();
      if (!text) return;
      menu.addItem(item => item.setTitle('发送到伴读侧栏（草稿）').setIcon('messages-square').onClick(() => this.stageTextSelection(text, view.file)));
    }));
    const attached = new WeakSet();
    const attach = doc => {
      if (!doc || attached.has(doc)) return;
      attached.add(doc);
      this.registerDomEvent(doc, 'contextmenu', event => {
        // Obsidian stops traversing a split when its callback returns truthy.
        const views = []; this.app.workspace.iterateAllLeaves(leaf => { views.push(leaf.view); });
        readingContextMenu(event, views, {menuForEvent: event => Menu.forEvent(event), stage: (text, file) => this.stageTextSelection(text, file), copy: text => clipboard.writeText(text)});
      }, true);
    };
    attach(globalThis.document);
    this.app.workspace.iterateAllLeaves(leaf => attach(leaf.view.containerEl?.ownerDocument));
    this.registerEvent(this.app.workspace.on('window-open', (_win, win) => attach(win.document)));
  }
  serialize(task) { const job = this.queue.then(task); this.queue = job.catch(() => {}); return job; }
  async getStorage(keys) {
    const out = {};
    for (const key of typeof keys === 'string' ? [keys] : keys || []) {
      if (key === 'credential') out[key] = this.account?.publicIdentity() || null;
      else if (key === 'authStatus') out[key] = this.authStatus;
      else if (ALLOWED_KEYS.has(key)) out[key] = structuredClone(this.data[key]);
    }
    return out;
  }
  async setStorage(values) {
    const changes = {};
    for (const [key, value] of Object.entries(values)) {
      if (!ALLOWED_KEYS.has(key)) throw new Error('不允许保存该设置。');
      changes[key] = {oldValue: this.data[key], newValue: structuredClone(value)};
      this.data[key] = structuredClone(value);
    }
    await this.saveData(this.data); this.broadcast({type: 'storageChanged', changes, area: 'local'});
  }
  async removeStorage(keys) {
    const changes = {};
    for (const key of typeof keys === 'string' ? [keys] : keys) if (ALLOWED_KEYS.has(key)) { changes[key] = {oldValue: this.data[key]}; delete this.data[key]; }
    await this.saveData(this.data); this.broadcast({type: 'storageChanged', changes, area: 'local'});
  }
  broadcast(message) { for (const view of this.views) view.post(message); }
  trackNote() {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView) || this.app.workspace.activeLeaf?.view;
    if (['md', 'pdf'].includes(view?.file?.extension)) this.lastNote = {file: view.file, editor: view.file.extension === 'md' ? view.editor : null};
  }
  async noteMaterial(file) {
    const source = file || this.lastNote?.file;
    if (!source || !(this.app.vault.getAbstractFileByPath(source.path) instanceof TFile) || !['md', 'pdf'].includes(source.extension)) throw new Error('请先打开一篇 Markdown 笔记或 PDF，再点击读取。');
    const url = 'obsidian://open?vault=' + encodeURIComponent(this.app.vault.getName()) + '&file=' + encodeURIComponent(source.path);
    if (source.extension === 'pdf') {
      if (source.stat?.size > 20000000) throw new Error('上传文件最多 20 MB。');
      const bytes = await this.app.vault.readBinary(source);
      if (bytes.byteLength > 20000000) throw new Error('上传文件最多 20 MB。');
      return {id: crypto.randomUUID(), name: source.path, url, pdfBase64: Buffer.from(bytes).toString('base64')};
    }
    const current = this.lastNote;
    const full = current?.file.path === source.path && current.editor ? current.editor.getValue() : await this.app.vault.cachedRead(source);
    return {id: crypto.randomUUID(), name: source.path, url, text: full.slice(0, 120000) + (full.length > 120000 ? '\n[内容截断：最多 120000 字符]' : '')};
  }
  async stageSelection(editor, file) {
    return this.stageTextSelection(editor.getSelection(), file);
  }
  async stageTextSelection(value, file) {
    const text = String(value || '').trim();
    if (!text) return new Notice('请先选择笔记中的文字。');
    await this.serialize(() => this.setStorage({selectionDraft: {id: crypto.randomUUID(), text: text.slice(0, 20000), title: file?.path || '笔记选文', url: file ? 'obsidian://open?vault=' + encodeURIComponent(this.app.vault.getName()) + '&file=' + encodeURIComponent(file.path) : ''}}));
    await this.activate();
  }
  async stageNote(file) {
    try { const material = await this.noteMaterial(file); await this.activate(); this.broadcast({type: 'stageMaterial', material}); }
    catch (e) { new Notice(e.message); }
  }
  async activate() {
    let leaf = this.app.workspace.getLeavesOfType(VIEW)[0];
    if (!leaf) { leaf = this.app.workspace.getRightLeaf(false) || this.app.workspace.getLeaf(true); await leaf.setViewState({type: VIEW, active: true}); }
    await leaf.loadIfDeferred?.(); this.app.workspace.revealLeaf(leaf);
    const view = leaf.view;
    if (view instanceof ChatView) await view.ready;
  }
  async handle(view, msg) {
    switch (msg.type) {
      case 'get': return {values: await this.getStorage(msg.keys)};
      case 'set': await this.serialize(() => this.setStorage(msg.values)); return {};
      case 'remove': await this.serialize(() => this.removeStorage(msg.keys)); return {};
      case 'chats': return this.serialize(() => chatAction(this.storage, msg.action));
      case 'uiReady': view.markReady(); return {};
      case 'accounts': return {registry: this.account ? await this.account.publicRegistrations() : {accounts: [], selected: ''}};
      case 'login': if (!this.account) throw new Error(this.authStatus); await this.account.login(msg.clientId); return {};
      case 'cancelLogin': this.account?.cancelLogin(); return {};
      case 'logout': this.cancelStreams(view); await this.account?.logout(); return {};
      case 'models': if (!this.account) throw new Error(this.authStatus); return {models: await this.account.models()};
      case 'token': if (!this.account) throw new Error(this.authStatus); await this.account.token(); return {};
      case 'readNote': return {material: await this.noteMaterial()};
      case 'clipboard': clipboard.writeText(String(msg.text || '')); return {};
      case 'exportFile': {
        const location = await saveExport(this.app.vault, this.exportDirectory, msg.name, msg.content);
        new Notice('已保存到 ' + location); return {path: location};
      }
      case 'openExternal': {
        const url = new URL(msg.url);
        if (!['https:', 'http:', 'mailto:'].includes(url.protocol)) throw new Error('不支持该链接。');
        await shell.openExternal(url.href); return {};
      }
      case 'cancelResponse': {
        const key = view.id + ':' + msg.requestId;
        this.stoppedRequests.add(key); this.requests.get(key)?.abort();
        await this.pumps.get(key);
        setTimeout(() => this.stoppedRequests.delete(key), 30000);
        return {};
      }
      case 'response': return this.startResponse(view, msg);
      default: throw new Error('未知插件操作。');
    }
  }
  async startResponse(view, msg) {
    const key = view.id + ':' + msg.requestId;
    if (this.requests.size || this.stoppedRequests.has(key) || !this.views.has(view)) throw new Error('请求已停止，或已有请求正在进行。');
    const controller = new AbortController(); this.requests.set(key, controller);
    try {
      const payload = msg.payload;
      if (!payload || typeof payload.model !== 'string' || !Array.isArray(payload.input)) throw new Error('请求格式不正确。');
      const token = await this.account.token();
      if (controller.signal.aborted || !this.views.has(view)) throw new Error('请求已停止。');
      const response = await officialFetch(API + '/responses', {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + token}, body: JSON.stringify({...payload, store: false, stream: true}), signal: controller.signal});
      if (!response.ok) { const error = await response.json().catch(() => ({})); throw new Error('请求失败：HTTP ' + response.status + (error.error?.message ? ' · ' + error.error.message.slice(0, 300) : '')); }
      const pump = this.pump(view, key, msg.requestId, response.body, controller);
      this.pumps.set(key, pump);
      return {status: response.status};
    } catch (e) { this.requests.delete(key); throw e; }
  }
  async pump(view, key, requestId, body, controller) {
    const reader = body.getReader();
    try {
      while (!controller.signal.aborted) {
        const {value, done} = await reader.read(); if (done) break;
        view.post({type: 'streamChunk', requestId, chunk: Array.from(value)});
      }
      view.post({type: 'streamEnd', requestId});
    } catch (e) { view.post({type: 'streamError', requestId, error: controller.signal.aborted ? '已停止生成' : e.message}); }
    finally { await reader.cancel().catch(() => {}); reader.releaseLock(); this.requests.delete(key); this.pumps.delete(key); }
  }
  cancelStreams(view) { for (const [key, controller] of this.requests) if (!view || key.startsWith(view.id + ':')) controller.abort(); }
  onunload() { this.account?.dispose(); this.cancelStreams(); for (const view of this.views) view.dispose(); }
}
class ChatView extends ItemView {
  constructor(leaf, plugin) { super(leaf); this.plugin = plugin; this.id = crypto.randomUUID(); this.channel = crypto.randomUUID(); this.ready = new Promise(resolve => { this.markReady = resolve; }); }
  getViewType() { return VIEW; }
  getDisplayText() { return '伴读侧栏'; }
  getIcon() { return 'messages-square'; }
  post(message) { this.frame?.contentWindow?.postMessage({channel: this.channel, ...message}, '*'); }
  async onOpen() {
    this.contentEl.empty(); this.contentEl.addClass('note-chat-host'); this.plugin.views.add(this);
    const dir = this.plugin.pluginDirectory;
    const files = await Promise.all(['ui.html', 'ui.js', 'ui.css', 'katex.css'].map(name => fs.readFile(path.join(dir, name), 'utf8')));
    const [html, script, css, katexCss] = files;
    const base = this.plugin.app.vault.adapter.getResourcePath((this.plugin.manifest.dir || this.plugin.app.vault.configDir + '/plugins/' + this.plugin.manifest.id) + '/ui.html');
    this.frame = this.contentEl.createEl('iframe', {cls: 'note-chat-frame', attr: {title: '伴读侧栏', sandbox: 'allow-scripts allow-same-origin', allow: 'clipboard-read; clipboard-write'}});
    const receive = async event => {
      const msg = event.data;
      if (event.source !== this.frame.contentWindow || msg?.channel !== this.channel || !msg.rpcId) return;
      try { const result = await this.plugin.handle(this, msg); this.post({type: 'rpcResult', rpcId: msg.rpcId, result: {ok: true, ...result}}); }
      catch (e) { this.post({type: 'rpcResult', rpcId: msg.rpcId, result: {ok: false, error: e.message}}); }
    };
    this.registerDomEvent(window, 'message', receive); this.frame.srcdoc = uiDocument({html, script, css, katexCss, base, channel: this.channel});
  }
  dispose() { this.plugin.cancelStreams(this); this.plugin.views.delete(this); this.frame?.remove(); this.markReady(); }
  async onClose() { this.dispose(); }
}
class NoteChatSettings extends PluginSettingTab {
  display() {
    this.containerEl.empty();
    new Setting(this.containerEl).setName('伴读侧栏').setDesc('每个笔记库独立保存对话和设置。账号与字体、主题、语言设置位于侧栏右上角。').addButton(button => button.setButtonText('打开侧栏').onClick(() => this.plugin.activate()));
    new Setting(this.containerEl).setName('Markdown 和生成文件的保存目录').setDesc('库内相对目录，默认“AI 对话”。保存同名文件时自动改名，不覆盖原笔记。').addText(text => text.setValue(this.plugin.exportDirectory).onChange(async value => {
      try { const folder = exportFolder(value); this.plugin.exportDirectory = folder; await this.plugin.serialize(async () => { this.plugin.data.exportDirectory = folder; await this.plugin.saveData(this.plugin.data); }); }
      catch { /* Let the user finish typing; invalid paths are not saved. */ }
    }));
    new Setting(this.containerEl).setName('隐私与资料读取').setDesc('选文、笔记和上传附件先进入草稿；发送时才交给 OpenAI。普通聊天不会读取当前笔记，也不会扫描整个库。第一版没有自动改写、删除或跨库读取工具。');
    new Setting(this.containerEl).setName('账号凭据').setDesc('本机系统加密，存放在笔记库之外；不会写入插件 data.json 或导出的 Markdown。更换电脑或移动库路径后需要重新登录。');
  }
}
