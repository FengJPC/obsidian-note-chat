import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {uiDocument} from '../src/ui-document.js';

function loadPlugin() {
  const source = fs.readFileSync(new URL('../dist/note-chat-sidebar/main.js', import.meta.url), 'utf8');
  class TFile { constructor(path) { this.path = path; this.extension = path.split('.').at(-1); } }
  const menus = [];
  class Menu { static forEvent() {const menu = new Menu(); menus.push(menu); return menu;} addItem(cb) {this.items ||= []; const item = {setTitle(title) {this.title=title;return this;},setIcon() {return this;},onClick(callback) {this.callback=callback;return this;}}; cb(item); this.items.push(item); return this;} showAtPosition(position, doc) {this.position=position;this.doc=doc;} }
  const obsidian = {Plugin: class {}, ItemView: class {}, PluginSettingTab: class {}, Setting: class {}, MarkdownView: class {}, Notice: class {}, TFile, Menu};
  const localRequire = createRequire(import.meta.url), module = {exports: {}};
  vm.runInNewContext(source, {module, exports: module.exports, require: id => id === 'obsidian' ? obsidian : id === 'electron' ? {} : localRequire(id), crypto, Buffer, process, URL, URLSearchParams, AbortSignal, AbortController, TextEncoder, TextDecoder, atob, btoa, structuredClone, setTimeout, clearTimeout, console});
  return {Plugin: module.exports.default, TFile, Menu, menus};
}
test('built Obsidian host reads the latest editor text only when requested', async () => {
  const {Plugin, TFile} = loadPlugin(), plugin = new Plugin();
  const file = new TFile('研究/能带.md'); let diskReads = 0;
  plugin.app = {vault: {getName: () => '测试库', getAbstractFileByPath: () => file, cachedRead: async () => { diskReads++; return 'stale disk value'; }}};
  plugin.lastNote = {file, editor: {getValue: () => 'current unsaved editor text'}};
  const material = await plugin.handle({}, {type: 'readNote'});
  assert.equal(material.material.text, 'current unsaved editor text'); assert.equal(diskReads, 0);
  assert.ok(material.material.url.startsWith('obsidian://open?'));
  plugin.authStatus='未连接'; await assert.rejects(plugin.handle({}, {type:'token'}), /未连接/);
});
test('host rejects credential writes and keeps authentication out of saved vault data', async () => {
  const {Plugin} = loadPlugin(), plugin = new Plugin(); let saved;
  plugin.data = {}; plugin.views = new Set(); plugin.saveData = async data => { saved = structuredClone(data); };
  plugin.account = {publicIdentity: () => ({email: 'test@example.invalid', subject: 'test'})};
  await plugin.setStorage({uiPrefs: {fontSize: 14}});
  assert.deepEqual(saved, {uiPrefs: {fontSize: 14}});
  await assert.rejects(plugin.setStorage({credential: {accessToken: 'fake'}}));
  const identity = await plugin.getStorage(['credential']);
  assert.equal(identity.credential.email, 'test@example.invalid'); assert.equal(saved.credential, undefined);
  await assert.rejects(plugin.handle({}, {type: 'readAllNotes'}));
  await assert.rejects(plugin.setStorage({accountRegistrations: {accessToken: 'fake'}}));
  await assert.rejects(plugin.setStorage({authDiagnostic:{code:'fake'}}));
  plugin.data.authDiagnostic={phase:'refresh',httpStatus:400,code:'invalid_grant'};
  assert.equal((await plugin.getStorage(['authDiagnostic'])).authDiagnostic.code,'invalid_grant');
});

test('authorization status updates only announce actual identity transitions, preventing model-refresh loops',()=>{
  const {Plugin}=loadPlugin(),plugin=new Plugin(),events=[];
  let identity={subject:'fixture',email:'test@example.invalid'};
  plugin.account={publicIdentity:()=>identity};plugin.broadcast=event=>events.push(event);
  plugin.updateAuthStatus('Connected');
  assert.equal(events.at(-1).changes.credential.oldValue,null);
  plugin.updateAuthStatus('Temporary refresh failure');
  assert.equal(events.at(-1).changes.credential,undefined);
  identity=null;plugin.updateAuthStatus('Sign in again');
  assert.equal(events.at(-1).changes.credential.newValue,null);
  assert.equal(events.at(-1).changes.credential.oldValue.subject,'fixture');
});

test('built host routes saved-client selection to login without storing authentication in vault data', async () => {
  const {Plugin} = loadPlugin(), plugin = new Plugin(); let selected;
  plugin.data = {};
  plugin.account = {publicRegistrations: async () => ({accounts: [{clientId: 'oaiapp_existing', subject: 'user'}], selected: 'oaiapp_existing'}), login: async clientId => {selected = clientId;}};
  const accounts = await plugin.handle({}, {type: 'accounts'});
  assert.equal(accounts.registry.selected, 'oaiapp_existing');
  await plugin.handle({}, {type: 'login', clientId: 'oaiapp_existing'});
  assert.equal(selected, 'oaiapp_existing'); assert.deepEqual(plugin.data, {});
});

test('editor context menu freezes selected text before focus changes and stores only a draft', async () => {
  const {Plugin, TFile, Menu} = loadPlugin(), plugin = new Plugin(), events = {};
  let selected = '原始选文', opened = 0;
  plugin.data = {}; plugin.views = new Set(); plugin.queue = Promise.resolve();
  plugin.app = {workspace: {on: (name, callback) => {events[name]=callback;},iterateAllLeaves() {}}, vault: {getName: () => '库'}};
  plugin.registerEvent = () => {}; plugin.registerDomEvent = () => {}; plugin.saveData = async () => {};
  plugin.activate = async () => {opened++;}; plugin.registerSelectionMenus();
  const menu = new Menu(); events['editor-menu'](menu, {getSelection: () => selected}, {file: new TFile('note.md')});
  selected = ''; await menu.items[0].callback();
  assert.equal(plugin.data.selectionDraft.text, '原始选文'); assert.equal(plugin.data.selectionDraft.title, 'note.md');
  assert.equal(opened, 1); assert.equal(plugin.requests, undefined);
});

test('reading menu listeners attach once per existing/popout document and retain preview/PDF provenance', async () => {
  const {Plugin, TFile, menus} = loadPlugin(), plugin = new Plugin(), events = {}, listeners = [];
  const root = {contains: () => true}, doc = {defaultView: {getSelection: () => ({isCollapsed:false,rangeCount:1,getRangeAt:() => ({startContainer:root,endContainer:root}),toString:() => 'PDF 选文'})}};
  const target = {ownerDocument:doc,closest:() => null}, file = new TFile('paper.pdf');
  plugin.app = {workspace: {on:(name,callback)=>{events[name]=callback;},iterateAllLeaves:callback=>{callback({view:{file,contentEl:root,containerEl:{ownerDocument:doc}}});}}};
  plugin.registerEvent = () => {}; plugin.registerDomEvent = (doc,type,callback,capture) => {listeners.push({doc,type,callback,capture});};
  let staged; plugin.stageTextSelection = async (text,file) => {staged={text,path:file.path};};
  plugin.registerSelectionMenus(); events['window-open']({}, {document:doc});
  assert.equal(listeners.length,1); assert.equal(listeners[0].capture,true);
  let prevented=false;
  listeners[0].callback({target,pageX:12,pageY:34,preventDefault(){prevented=true;},stopPropagation(){}});
  doc.defaultView.getSelection = () => null;
  await menus[0].items.find(item=>item.title.includes('伴读侧栏')).callback();
  assert.equal(prevented,true); assert.deepEqual(staged,{text:'PDF 选文',path:'paper.pdf'});
});

test('active PDF replaces the prior Markdown target; binary reading happens only on explicit request', async () => {
  const {Plugin, TFile} = loadPlugin(), plugin = new Plugin(), pdf = new TFile('研究/paper.pdf');
  let reads=0;
  plugin.lastNote = {file:new TFile('previous.md'),editor:{getValue:()=> 'prior note'}};
  plugin.app = {workspace: {getActiveViewOfType:()=>null,activeLeaf:{view:{file:pdf}}},vault:{getName:()=> '库',getAbstractFileByPath:()=>pdf,readBinary:async()=>{reads++;return new TextEncoder().encode('%PDF fixture').buffer;}}};
  plugin.trackNote(); assert.equal(reads,0); assert.equal(plugin.lastNote.file,pdf);
  const result = await plugin.handle({}, {type:'readNote'});
  assert.equal(reads,1); assert.equal(result.material.name,pdf.path);
  assert.equal(Buffer.from(result.material.pdfBase64,'base64').toString(),'%PDF fixture');
  pdf.stat={size:20000001}; await assert.rejects(plugin.noteMaterial(),/20 MB/); assert.equal(reads,1);
});

test('reading menu visits later tabs when Obsidian stops traversal on truthy callbacks', async () => {
  const {Plugin, TFile, menus} = loadPlugin(), plugin = new Plugin(), listeners = [];
  const root = {contains: () => true};
  const doc = {defaultView: {getSelection: () => ({isCollapsed:false, rangeCount:1,
    getRangeAt:() => ({startContainer:root,endContainer:root}), toString:() => '后面的标签页'})}};
  const target = {ownerDocument:doc,closest:() => null};
  let selectedFile, visited;
  const leaves = [{view:{file:new TFile('first.md'),getMode:() => 'source',containerEl:{ownerDocument:doc}}},
    {view:{file:new TFile('later.md'),getMode:() => 'preview',previewMode:{containerEl:root},containerEl:{ownerDocument:doc}}},
    {view:{file:new TFile('later.pdf'),contentEl:root,containerEl:{ownerDocument:doc}}}];
  plugin.app = {workspace:{on() {},iterateAllLeaves(callback) {
    visited=[]; for(const leaf of leaves) {visited.push(leaf); if(callback(leaf)) break;}
  }}};
  plugin.registerEvent=() => {}; plugin.registerDomEvent=(_doc,_type,callback) => listeners.push(callback);
  plugin.stageTextSelection=async (_text,file) => {selectedFile=file.path;};
  plugin.registerSelectionMenus();
  for(const extension of ['md','pdf']) {
    leaves[1].view.getMode=() => extension === 'md' ? 'preview' : 'source';
    listeners[0]({target,pageX:1,pageY:1,preventDefault(){},stopPropagation(){}});
    assert.equal(visited.length,3);
    await menus.at(-1).items.find(item => item.title.includes('伴读侧栏')).callback();
    assert.equal(selectedFile,'later.'+extension);
  }
});
test('embedded UI assembly preserves replacement strings and neutralizes closing script delimiters', () => {
  const result = uiDocument({html: '<head><link rel="stylesheet" href="ui.css"><script src="ui.js"></script>', script: 'const a="$&";const b="</script>";', css: ':root{}', katexCss: '', channel: 'test', base: 'app://test/ui.html'});
  assert.ok(result.includes('const a="$&";')); assert.ok(result.includes('const b="<\\/script>";'));
  assert.ok(!result.includes('<script src="ui.js">')); assert.ok(result.includes('window.NOTE_CHAT_CHANNEL="test"'));
});

test('public download is denied by the host unless both toggles and the live view permit it',async()=>{
  const {Plugin}=loadPlugin(),plugin=new Plugin(),view={id:'public-view'};
  plugin.views=new Set([view]);plugin.stoppedRequests=new Set();plugin.publicRequests=new Map();
  for(const uiPrefs of [{},{webSearch:true},{publicRead:true},{webSearch:'true',publicRead:true}]){
    plugin.data={uiPrefs};await assert.rejects(plugin.handle(view,{type:'publicRead',requestId:'r',url:'https://example.com'}),/开启联网/);
  }
  plugin.data={uiPrefs:{webSearch:true,publicRead:true}};
  await assert.rejects(plugin.handle({id:'other'},{type:'publicRead',url:'https://example.com'}),/开启联网/);
  plugin.stoppedRequests.add('public-view:r');await assert.rejects(plugin.handle(view,{type:'publicRead',requestId:'r',url:'https://example.com'}),/已停止/);
  plugin.stoppedRequests.clear();await assert.rejects(plugin.handle(view,{type:'publicRead',requestId:'r',url:'https://localhost'}),/public HTTPS/);
  assert.equal(plugin.publicRequests.size,0);
});

test('closing a view cancels its model and public reads but leaves other views alone',()=>{
  const {Plugin}=loadPlugin(),plugin=new Plugin(),a=new AbortController(),b=new AbortController(),other=new AbortController();
  plugin.requests=new Map([['a:model',a]]);plugin.publicRequests=new Map([['a:read',b],['b:read',other]]);
  plugin.cancelStreams({id:'a'});assert.equal(a.signal.aborted,true);assert.equal(b.signal.aborted,true);assert.equal(other.signal.aborted,false);
  plugin.cancelStreams();assert.equal(other.signal.aborted,true);
});
