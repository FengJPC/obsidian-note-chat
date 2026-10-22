const {chromium} = require('playwright');
const {PDFDocument, StandardFonts} = require('pdf-lib');
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), runtime = path.join(root, 'dist/note-chat-sidebar');
(async () => {
  const {uiDocument} = await import('../src/ui-document.js');
  const {chatAction} = await import('../src/shared/chats.js');
  const {RegistrationStore, NEW_ACCOUNT} = await import('../src/registrations.js');
  const checks = [], errors = [], requests = [], exports = []; let reads = 0, activeVault = 'A', hold = false, currentPDF;
  const stores = {A: {}, B: {}};
  const html = uiDocument({html: fs.readFileSync(path.join(runtime, 'ui.html'), 'utf8'), script: fs.readFileSync(path.join(runtime, 'ui.js'), 'utf8'), css: fs.readFileSync(path.join(runtime, 'ui.css'), 'utf8'), katexCss: fs.readFileSync(path.join(runtime, 'katex.css'), 'utf8'), base: 'http://127.0.0.1/ui.html', channel: 'fixture-channel'});
  const pageHtml = `<!doctype html><meta charset="utf-8"><style>body{margin:0;display:flex;height:100vh;background:#f8f7f3;font:16px system-ui}aside{padding:30px;flex:1}iframe{width:420px;border:0;border-left:1px solid #ddd}</style><aside><h2>Obsidian 伴读侧栏 · 界面测试</h2><p>此页面使用模拟账号与回答验证界面，不代表真实登录。</p></aside><iframe id="panel" sandbox="allow-scripts allow-same-origin"></iframe><script>
  const frame=document.getElementById('panel');
  window.deliver=message=>frame.contentWindow.postMessage({channel:'fixture-channel',...message},'*');
  window.addEventListener('message',async event=>{const m=event.data;if(event.source!==frame.contentWindow||m?.channel!=='fixture-channel'||!m.rpcId)return;try{const result=await window.fixtureRPC(m);deliver({type:'rpcResult',rpcId:m.rpcId,result:{ok:true,...result}});}catch(e){deliver({type:'rpcResult',rpcId:m.rpcId,result:{ok:false,error:e.message}});}});
  fetch('/document').then(r=>r.text()).then(html=>{frame.srcdoc=html;});
  </script>`;
  const server = http.createServer((req, res) => { if(req.url === '/selection-menu.js'){res.setHeader('Content-Type','text/javascript; charset=utf-8');return res.end(fs.readFileSync(path.join(root,'src/selection-menu.js')));} res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(req.url === '/document' ? html : pageHtml); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  server.unref();
  fs.mkdirSync(path.join(root, 'artifacts'), {recursive: true});
  const profile = fs.mkdtempSync(path.join(root, 'artifacts/browser-profile-'));
  const registrationStore = () => new RegistrationStore('vault-' + activeVault, path.join(profile, 'registration-fixture'));
  const loginChoices = [];
  const browser = await chromium.launchPersistentContext(profile, {executablePath: process.env.EDGE_EXECUTABLE_PATH || path.join(process.env['ProgramFiles(x86)'] || 'C:/Program Files (x86)', 'Microsoft/Edge/Application/msedge.exe'), headless: true});
  const page = await browser.newPage({viewport: {width: 1150, height: 900}});
  page.on('pageerror', e => { errors.push(e.message); });
  const changed = async changes => page.evaluate(changes => deliver({type: 'storageChanged', changes, area: 'local'}), changes);
  const storage = {
    get: async keys => Object.fromEntries((typeof keys === 'string' ? [keys] : keys).map(key => [key, stores[activeVault][key]])),
    set: async values => { const changes = {}; for (const [key, value] of Object.entries(values)) { changes[key] = {oldValue: stores[activeVault][key], newValue: value}; stores[activeVault][key] = structuredClone(value); } await changed(changes); },
    remove: async keys => { for (const key of typeof keys === 'string' ? [keys] : keys) delete stores[activeVault][key]; },
  };
  async function sendEvents(requestId, events) {
    for (const event of events) {
      const bytes = Buffer.from('data: ' + JSON.stringify(event) + '\n\n');
      for (let n = 0; n < bytes.length; n += 97) await page.evaluate(m => deliver(m), {type: 'streamChunk', requestId, chunk: Array.from(bytes.subarray(n, n + 97))});
    }
    await page.evaluate(m => deliver(m), {type: 'streamEnd', requestId});
  }
  await page.exposeFunction('fixtureRPC', async msg => {
    if (msg.type === 'get') return {values: await storage.get(msg.keys)};
    if (msg.type === 'set') { await storage.set(msg.values); return {}; }
    if (msg.type === 'remove') { await storage.remove(msg.keys); return {}; }
    if (msg.type === 'chats') return chatAction(storage, msg.action);
    if (msg.type === 'accounts') return {registry: await registrationStore().read()};
    if (msg.type === 'login') { loginChoices.push(msg.clientId); const identity = {clientId: msg.clientId && msg.clientId !== NEW_ACCOUNT ? msg.clientId : 'oaiapp_fixture', subject: 'test-user', email: 'test@example.invalid'}; await registrationStore().remember(identity); await storage.set({credential: identity, authStatus: '账号已连接，可以选择模型并聊天。'}); return {}; }
    if (msg.type === 'logout') { await storage.set({credential: null, authStatus: '已断开'}); return {}; }
    if (msg.type === 'models') return {models: [{id: 'fixture-model', name: 'Test model (mock)', efforts: ['low', 'medium', 'high']}]};
    if (msg.type === 'readNote') { reads++; return {material: currentPDF ? {id:'pdf-'+reads,name:'研究/viewed.pdf',pdfBase64:currentPDF,url:'obsidian://open?file=viewed.pdf'} : {id: 'note-' + reads, name: '研究/量子笔记.md', text: 'Quantum note: E = hbar omega.', url: 'obsidian://open?vault=Fixture&file=note.md'}}; }
    if (msg.type === 'token' || msg.type === 'cancelResponse' || msg.type === 'cancelLogin' || msg.type === 'clipboard' || msg.type === 'uiReady') return {};
    if (msg.type === 'exportFile') { exports.push({name: msg.name, content: msg.content}); return {path: 'AI 对话/' + msg.name}; }
    if (msg.type === 'response') {
      requests.push(msg.payload);
      assert.equal(msg.payload.store, false); assert.equal(msg.payload.stream, true);
      const hasOutput = msg.payload.input.at(-1)?.type === 'function_call_output';
      const content = '你好，公式是 \\(E=\\hbar\\omega\\)。\n\n\\[\\int_0^1 x^2\\,dx=\\frac13\\]\n\n<script>window.UNSAFE=true</script><img src="https://evil.invalid/pixel">';
      let events;
      if (hold) events = [{type: 'response.output_text.delta', delta: '部分回答'}];
      else if (msg.payload.tools && !hasOutput) events = [
        {type: 'response.output_item.done', output_index: 0, item: {type: 'reasoning', id: 'r', encrypted_content: 'fixture-encrypted'}},
        {type: 'response.output_item.done', output_index: 1, item: {type: 'function_call', call_id: 'file-call', name: 'create_text_file', namespace: 'files', arguments: JSON.stringify({filename: '研究笔记.md', content: '# Test\n\n$E=\\hbar\\omega$'})}},
        {type: 'response.completed', response: {output: []}},
      ];
      else events = [{type: 'response.output_text.delta', delta: content}, {type: 'response.output_item.done', output_index: 0, item: {type: 'message', role: 'assistant', content: [{type: 'output_text', text: content}]}}, {type: 'response.completed', response: {output: []}}];
      setTimeout(() => { if (hold) page.evaluate(m => deliver(m), {type: 'streamChunk', requestId: msg.requestId, chunk: Array.from(Buffer.from('data: ' + JSON.stringify(events[0]) + '\n\n'))}).catch(() => {}); else sendEvents(msg.requestId, events).catch(e => errors.push(e.message)); }, 20);
      return {status: 200};
    }
    throw new Error('Unknown fixture message: ' + msg.type);
  });
  const frame = () => page.frameLocator('#panel');
  async function ready() { await frame().locator('#prompt').waitFor(); await page.waitForFunction(() => document.getElementById('panel').contentDocument?.getElementById('requestStatus')?.textContent.includes('连接')); }
  async function say(text) { await frame().locator('#prompt').fill(text); await frame().locator('#send').click(); await frame().locator('#stop').waitFor({state: 'hidden', timeout: 20000}); }
  try {
    await page.goto('http://127.0.0.1:' + server.address().port); await ready();
    assert.equal(await frame().locator('#send').isDisabled(), true); assert.equal(reads, 0);
    await frame().locator('#settings').click(); await frame().locator('#login').click();
    await frame().locator('#model option[value="fixture-model"]').waitFor({state: 'attached'});
    await frame().locator('#fontSize').selectOption('14'); await frame().locator('#themeSetting').selectOption('dark'); await frame().locator('#language').selectOption('en');
    assert.equal(await frame().locator('header strong').textContent(), 'Note Chat');
    await frame().locator('#language').selectOption('zh-CN'); await frame().locator('[data-close="settingsDialog"]').click();
    await frame().locator('#effort').selectOption('high'); await say('你好');
    assert.equal(reads, 0); assert.equal(requests[0].reasoning.effort, 'high'); assert.equal(requests[0].tools, undefined);
    assert.equal(await frame().locator('.katex').count(), 2);
    assert.equal(await frame().locator('.message.assistant script,.message.assistant img').count(), 0);
    checks.push('Isolated sidebar boots; account/model/effort, themes/languages and sanitized LaTeX response render');
    await frame().locator('#newChat').click(); await frame().locator('#history').click();
    assert.equal(await frame().locator('.history-item').count(), 1);
    await frame().locator('[data-close="historyDialog"]').click();
    await frame().locator('#prompt').fill('没有发送的草稿'); await page.waitForTimeout(500);
    await page.reload(); await frame().locator('#prompt').waitFor(); await page.waitForTimeout(800);
    assert.equal(await frame().locator('#prompt').inputValue(), '没有发送的草稿');
    assert.equal(stores.A.chatStore.chats.filter(c => c.messages.length).length, 1);
    checks.push('Unsent blank chats stay out of history; drafts and preferences survive reopening');
    await storage.set({selectionDraft: {id: 'selection', text: '解释选中的句子', title: '研究笔记', url: 'obsidian://open?file=test'}});
    await page.waitForTimeout(400); assert.ok((await frame().locator('#prompt').inputValue()).includes('解释选中的句子'));
    assert.equal(requests.length, 1);
    await frame().locator('#readPage').click(); await frame().locator('.material-chip').waitFor();
    assert.equal(reads, 1); assert.equal(requests.length, 1);
    await frame().locator('.material-chip button').click();
    await say('你能读一下当前笔记吗'); assert.equal(reads, 1);
    await say('读一下当前笔记'); assert.equal(reads, 2);
    assert.ok(JSON.stringify(requests.at(-1).input).includes('Quantum note'));
    checks.push('Selections and note button stage drafts; questions/ordinary chat do not read notes; explicit read supplies note');
    const pdf = await PDFDocument.create(); const p = pdf.addPage(); const font = await pdf.embedFont(StandardFonts.Helvetica); p.drawText('Quantum PDF fixture text', {x: 30, y: 700, font});
    const pdfBuffer = Buffer.from(await pdf.save());
    currentPDF = pdfBuffer.toString('base64');
    const beforePDF = requests.length;
    await frame().locator('#readPage').click(); await frame().locator('.material-chip').waitFor({timeout:20000});
    assert.ok(stores.A.chatStore.chats.find(c=>c.id===stores.A.chatStore.active).materials[0].text.includes('Quantum PDF fixture text'));
    assert.equal(requests.length,beforePDF); await frame().locator('.material-chip button').click(); currentPDF = null;
    checks.push('Explicit current-PDF read decodes a host binary receipt locally and stages extracted text without sending');
    await frame().locator('#uploadInput').setInputFiles({name: 'paper.pdf', mimeType: 'application/pdf', buffer: pdfBuffer});
    await frame().locator('.material-chip').waitFor({timeout: 20000});
    const stored = stores.A.chatStore.chats.find(c => c.id === stores.A.chatStore.active);
    assert.ok(stored.materials[0].text.includes('Quantum PDF fixture text'));
    await frame().locator('.material-chip button').click();
    const png = Buffer.from(await frame().locator('#prompt').evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = 40; canvas.height = 30; const ctx = canvas.getContext('2d'); ctx.fillStyle = '#276d46'; ctx.fillRect(0, 0, 40, 30); return canvas.toDataURL('image/png').split(',')[1]; }), 'base64');
    await frame().locator('#uploadInput').setInputFiles({name: 'image.png', mimeType: 'image/png', buffer: png}); await frame().locator('.material-chip img').waitFor();
    assert.equal(requests.length, 3); await say('解释我提供的图片'); assert.ok(JSON.stringify(requests.at(-1).input).includes('input_image'));
    checks.push('Bundled PDF worker extracts real PDF text; image upload stages and sends multimodal input');
    await say('请生成一个 md 文件'); await frame().locator('.attachment').waitFor();
    const toolPayload = requests.at(-1); assert.ok(toolPayload.input.some(i => i.type === 'reasoning' && i.encrypted_content));
    assert.ok(toolPayload.input.some(i => i.type === 'function_call_output'));
    const before = exports.length; await frame().locator('.attachment').last().click(); await page.waitForTimeout(150);
    assert.equal(exports.length, before + 1); assert.equal(exports.at(-1).name, '研究笔记.md');
    await frame().locator('#settings').click(); await frame().locator('#export').click(); await page.waitForTimeout(150);
    assert.ok(exports.at(-1).content.includes('$E=\\hbar\\omega$')); assert.ok(!exports.at(-1).content.includes('fixture-encrypted'));
    await frame().locator('[data-close="settingsDialog"]').click();
    checks.push('File tools preserve encrypted reasoning across rounds; files/chats save only when clicked; MD uses Obsidian math');
    hold = true; await frame().locator('#prompt').fill('长回答'); await frame().locator('#send').click(); await frame().locator('#stop').waitFor();
    assert.equal(await frame().locator('#effort').isDisabled(), true); await frame().locator('#stop').click(); await frame().locator('#stop').waitFor({state: 'hidden'}); hold = false;
    const count = requests.length; await page.reload(); await frame().locator('#prompt').waitFor(); await page.waitForTimeout(500);
    assert.equal(requests.length, count); assert.ok(stores.A.chatStore.chats.some(c => c.messages.some(m => m.failed)));
    checks.push('Stop locks model controls, preserves interrupted history and never auto-resends on reload');
    await page.screenshot({path: path.join(root, 'artifacts/ui-dark.png')});
    activeVault = 'B'; await page.reload(); await frame().locator('#prompt').waitFor(); await page.waitForTimeout(500);
    assert.equal(await frame().locator('.message').count(), 0); assert.equal(await frame().locator('#send').isDisabled(), true);
    await frame().locator('#history').click(); assert.equal(await frame().locator('.history-item').count(), 0); await frame().locator('[data-close="historyDialog"]').click();
    checks.push('Separate vault has no inherited conversation or account');
    await page.screenshot({path: path.join(root, 'artifacts/ui-light-empty.png')});
    await frame().locator('#settings').click();
    await frame().locator('#loginAccountLabel').waitFor({state: 'visible'});
    assert.equal(await frame().locator('#loginAccount').inputValue(), 'oaiapp_fixture');
    assert.equal(await frame().locator('#loginAccount option').count(), 2);
    await frame().locator('#login').click();
    await frame().locator('#logout').waitFor({state: 'visible'});
    assert.equal(loginChoices.at(-1), 'oaiapp_fixture');
    assert.equal((await registrationStore().read()).accounts.length, 1);
    const historyA = structuredClone(stores.A.chatStore);
    await frame().locator('#logout').click();
    await frame().locator('#loginAccountLabel').waitFor({state: 'visible'});
    assert.equal(stores.B.credential, null);
    assert.equal(stores.A.credential.clientId, 'oaiapp_fixture');
    assert.deepEqual(stores.A.chatStore, historyA);
    await page.reload(); await frame().locator('#prompt').waitFor();
    await frame().locator('#settings').click();
    await frame().locator('#loginAccountLabel').waitFor({state: 'visible'});
    assert.equal(await frame().locator('#loginAccount').inputValue(), 'oaiapp_fixture');
    await frame().locator('#language').selectOption('en');
    await frame().locator('#loginAccount option[value="__new__"]').filter({hasText:'new registration'}).waitFor({state:'attached'});
    await frame().locator('#language').selectOption('zh-CN');
    await frame().locator('#loginAccount option[value="__new__"]').filter({hasText:'新登记'}).waitFor({state:'attached'});
    await frame().locator('#loginAccount').selectOption(NEW_ACCOUNT);
    assert.equal(await frame().locator('#loginAccount').inputValue(), NEW_ACCOUNT);
    assert.equal(loginChoices.length, 2); // Selecting alone never opens authorization.
    await frame().locator('#loginAccount').selectOption('oaiapp_fixture');
    await page.screenshot({path: path.join(root, 'artifacts/ui-registered-account.png')});
    checks.push('New vault offers the saved registration without inheriting tokens/history; logout and reload preserve default reuse, bilingual account choices and explicit new-registration option');
    await frame().locator('[data-close="settingsDialog"]').click();
    await page.evaluate(async()=>{
      const {readingContextMenu}=await import('/selection-menu.js');
      const aside=document.querySelector('aside');
      aside.insertAdjacentHTML('beforeend','<section id="preview-note"><h3>阅读视图选文</h3><span id="note-text">这是一段阅读视图的选文。</span></section><section id="pdf-note"><h3>PDF 文本层选文</h3><span id="pdf-text">Quantum PDF selected text.</span></section><p id="outside">其他区域的文字</p>');
      const views=[{file:{path:'reading.md',extension:'md'},getMode:()=> 'preview',previewMode:{containerEl:document.querySelector('#preview-note')}},{file:{path:'paper.pdf',extension:'pdf'},contentEl:document.querySelector('#pdf-note')}];
      document.addEventListener('contextmenu',event=>readingContextMenu(event,views,{
        copy:()=>{},stage:async(text,file)=>{await window.fixtureRPC({type:'set',values:{selectionDraft:{id:crypto.randomUUID(),text,title:file.path,url:'obsidian://open?file='+file.path}}});},
        menuForEvent:()=>{document.querySelector('.selection-menu')?.remove();const el=document.createElement('div');el.className='selection-menu';el.style.cssText='position:absolute;background:white;border:1px solid #777;padding:8px;z-index:100';return {addItem(cb){const button=document.createElement('button');button.style.cssText='display:block;margin:4px;padding:8px';cb({setTitle(text){button.textContent=text;return this;},setIcon(){return this;},onClick(fn){button.onclick=()=>{window.getSelection().removeAllRanges();fn();el.remove();};return this;}});el.append(button);},showAtPosition(position){el.style.left=position.x+'px';el.style.top=position.y+'px';document.body.append(el);}};}
      }),true);
    });
    const beforeSelection=requests.length;
    for(const [id,expected] of [['note-text','阅读视图的选文'],['pdf-text','Quantum PDF selected text']]){
      await page.locator('#'+id).evaluate(el=>{const range=document.createRange();range.selectNodeContents(el);const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);});
      await page.locator('#'+id).click({button:'right',position:{x:5,y:5}});
      await page.locator('.selection-menu button').filter({hasText:'发送到伴读侧栏'}).waitFor();
      await page.screenshot({path:path.join(root,'artifacts/ui-selection-'+id+'.png')});
      await page.locator('.selection-menu button').filter({hasText:'发送到伴读侧栏'}).click();
      await page.waitForFunction(expected=>document.getElementById('panel').contentDocument.getElementById('prompt').value.includes(expected),expected);
    }
    for(let n=0;stores.B.selectionDraft&&n<50;n++)await page.waitForTimeout(20);
    assert.equal(requests.length,beforeSelection);assert.equal(stores.B.selectionDraft,undefined);
    assert.ok(stores.B.chatStore.chats.find(c=>c.id===stores.B.chatStore.active).draft.includes('Quantum PDF selected text'));
    await page.locator('#outside').evaluate(el=>{const range=document.createRange();range.selectNodeContents(el);const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);});
    await page.locator('#outside').dispatchEvent('contextmenu',{bubbles:true,cancelable:true});
    assert.equal(await page.locator('.selection-menu').count(),0);
    checks.push('Real DOM selection in reading Markdown and PDF text-layer fixtures shows the menu; clicking after selection clears stages the captured text, never sends; unrelated selections get no menu');
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(root, 'artifacts/ui-results.json'), JSON.stringify({ok: true, checks, requests: requests.length, exports: exports.length, noteReads: reads, errors}, null, 2));
    console.log(JSON.stringify({ok: true, checks}, null, 2));
  } catch (error) {
    console.error('UI failure details:', await frame().locator('#requestStatus').textContent().catch(() => ''), errors);
    await page.screenshot({path: path.join(root, 'artifacts/ui-failure.png')}).catch(() => {});
    throw error;
  } finally { await browser.close(); server.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
