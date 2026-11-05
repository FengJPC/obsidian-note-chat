// Exercise the installed Obsidian runtime in an isolated profile and test vault.
const { chromium } = require('playwright');
const { PDFDocument, StandardFonts } = require('pdf-lib');
const fs = require('node:fs/promises'), path = require('node:path'), assert = require('node:assert/strict');
const {spawn} = require('node:child_process');
const net = require('node:net');

(async () => {
  const project = path.resolve(__dirname, '..');
  const executable = process.env.OBSIDIAN_EXECUTABLE_PATH;
  if (!executable) throw new Error('Set OBSIDIAN_EXECUTABLE_PATH to your installed Obsidian executable before running this optional desktop test.');
  const directory = await fs.mkdtemp(path.join(project, 'artifacts', 'obsidian-selection-'));
  const profile = path.join(directory, 'profile'), vault = path.join(directory, 'vault');
  const plugin = path.join(vault, '.obsidian', 'plugins', 'note-chat-sidebar');
  await fs.mkdir(profile, {recursive:true}); await fs.mkdir(plugin, {recursive:true});
  await fs.cp(path.join(project, 'dist', 'note-chat-sidebar'), plugin, {recursive:true});
  await fs.writeFile(path.join(vault,'.obsidian','community-plugins.json'), '["note-chat-sidebar"]');
  await fs.writeFile(path.join(vault,'.obsidian','core-plugins.json'), '[]');
  await fs.writeFile(path.join(vault,'first.md'), '# First tab\nThis tab remains open to test workspace traversal.');
  await fs.writeFile(path.join(vault,'reading.md'), '# Reading selection\n\nLater reading tab: quantum research text.');
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for(let n=1;n<=7;n++) {
    const pdfPage=pdf.addPage([600,800]);
    pdfPage.drawText('Later PDF tab: selected quantum research text. BOOK_PAGE_'+n, {x:40,y:720,size:12,font});
  }
  await fs.writeFile(path.join(vault,'paper.pdf'), await pdf.save());
  await fs.writeFile(path.join(profile,'obsidian.json'), JSON.stringify({vaults:{'ab1234ef5678abcd':{path:vault,ts:Date.now(),open:true}}}));
  const runtime = process.env.OBSIDIAN_RUNTIME_ASAR || 'obsidian-1.15.0.asar';
  await fs.copyFile(path.join(process.env.APPDATA,'obsidian',runtime), path.join(profile,runtime));
  let browser, context, processHandle;
  try {
    const port=await new Promise(resolve => {const server=net.createServer();server.listen(0,'127.0.0.1',() => {const port=server.address().port;server.close(()=>resolve(port));});});
    processHandle=spawn(executable,
      ['--user-data-dir='+profile,'--remote-debugging-port='+port,'--disable-gpu','--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows'],
      {windowsHide:true,stdio:'ignore',env:{...process.env,LOCALAPPDATA:path.join(directory,'local-data')}});
    processHandle.on('error',error=>console.error('Obsidian launch error:',error.message));
    const endpoint='http://127.0.0.1:'+port;
    for(let n=0;n<90;n++) {
      try {const response=await fetch(endpoint+'/json/version');if(response.ok)break;} catch {}
      await new Promise(resolve=>setTimeout(resolve,500));
      if(n===89)throw new Error('Isolated Obsidian CDP did not start');
    }
    browser=await chromium.connectOverCDP(endpoint);context=browser.contexts()[0];
    let window=context.pages()[0];
    if(!window)window=await context.waitForEvent('page');
    await window.waitForFunction(() => globalThis.app?.workspace?.layoutReady, null, {timeout:45000});
    window.on('pageerror', error=>console.error('Test vault page error:',error.message));
    await window.evaluate(() => {
      const win=window.electron?.remote?.getCurrentWindow();
      win?.webContents.setBackgroundThrottling(false);win?.showInactive();
    });
    console.log('Real Obsidian test vault loaded.');
    await window.evaluate(async () => {
      if(!app.plugins.isEnabled())await app.plugins.setEnable(true);
      if(!app.plugins.plugins['note-chat-sidebar'])await app.plugins.enablePlugin('note-chat-sidebar');
      if(!app.plugins.plugins['note-chat-sidebar'])throw new Error('Test plugin did not load');
      const first=app.workspace.getLeaf('tab'); await first.openFile(app.vault.getAbstractFileByPath('first.md'));
      const reading=app.workspace.getLeaf('tab'); await reading.openFile(app.vault.getAbstractFileByPath('reading.md'));
      await reading.setViewState({type:'markdown',state:{file:'reading.md',mode:'preview'},active:true});
      await reading.loadIfDeferred?.();
      app.workspace.setActiveLeaf(reading,{focus:true});
      reading.view.previewMode.containerEl.dataset.noteChatTest='reading';
    });
    console.log('Real reading view opened.');
    // Obsidian 1.15 asks whether to trust this newly generated fixture vault.
    // This profile contains only our generated notes, PDF, and built plugin.
    const trust=window.getByRole('button',{name:/信任仓库作者并启用插件|Trust.*enable plugins/i});
    try { await trust.waitFor({timeout:5000}); await trust.click(); }
    catch(error) { if(await trust.count())throw error; }
    const checks=[];
    async function exercise(name, selector, expected, screenshot) {
      await window.locator(selector).first().waitFor({state:'visible',timeout:20000});
      await window.locator(selector).first().evaluate(el => {
        const range=document.createRange();range.selectNodeContents(el);
        const selection=el.ownerDocument.defaultView.getSelection();selection.removeAllRanges();selection.addRange(range);
      });
      await window.locator(selector).first().click({button:'right'});
      const item=window.locator('.menu-item').filter({hasText:'发送到伴读侧栏（草稿）'});
      await item.waitFor({timeout:7000});
      await window.screenshot({path:path.join(project,'artifacts',screenshot)});
      await item.click();
      await window.waitForFunction(file => globalThis.app.plugins.plugins['note-chat-sidebar'].data.selectionDraft?.title===file,name);
      const receipt=await window.evaluate(() => {
        const p=app.plugins.plugins['note-chat-sidebar'];
        return {text:p.data.selectionDraft.text,title:p.data.selectionDraft.title,requests:p.requests.size,version:p.manifest.version};
      });
      assert.ok(receipt.text.includes(expected)); assert.equal(receipt.requests,0);
      checks.push({view:name,version:receipt.version,menu:true,draft:true,automaticRequests:receipt.requests});
      console.log('Passed real Obsidian selection:',name);
    }
    await exercise('reading.md','[data-note-chat-test="reading"] p','quantum research','obsidian-reading-menu.png');
    await window.evaluate(async () => {
      const leaf=app.workspace.getLeaf('tab');await leaf.openFile(app.vault.getAbstractFileByPath('paper.pdf'));
      await leaf.loadIfDeferred?.();
      app.workspace.setActiveLeaf(leaf,{focus:true});
      leaf.view.contentEl.dataset.noteChatTest='pdf';
    });
    await exercise('paper.pdf','[data-note-chat-test="pdf"] .textLayer span','selected quantum','obsidian-pdf-menu.png');
    const pdfLeaf=await window.evaluateHandle(()=>app.workspace.getLeavesOfType('pdf').find(leaf=>leaf.view.file?.path==='paper.pdf'));
    await window.waitForFunction(()=>app.workspace.getLeavesOfType('pdf').find(leaf=>leaf.view.file?.path==='paper.pdf')?.view.viewer?.child?.pdfViewer?.pdfDocument?.numPages===7);
    for(const [current,start,end] of [[4,3,5],[1,1,2],[7,6,7]]) {
      const receipt=await window.evaluate(async ({current,pdfLeaf})=>{
        const plugin=app.plugins.plugins['note-chat-sidebar'];
        app.workspace.setActiveLeaf(pdfLeaf,{focus:true});
        const reader=pdfLeaf.view.viewer.child.pdfViewer;
        reader.pdfViewer.currentPageNumber=current;
        plugin.trackNote();
        // A fresh right pane can be deferred until explicitly revealed.
        const sidebar=app.workspace.getLeavesOfType('note-chat-sidebar-view')[0];
        if(sidebar) {await app.workspace.revealLeaf(sidebar);await sidebar.loadIfDeferred?.();}
        await Promise.race([plugin.activate(),new Promise((_,reject)=>setTimeout(()=>reject(new Error('Sidebar did not become ready')),20000))]);
        const material=await plugin.noteMaterial();
        return {material,pageAfter:reader.pdfViewer.currentPageNumber,requests:plugin.requests.size};
      },{current,pdfLeaf});
      console.log('Real PDF receipt:',JSON.stringify({name:receipt.material.name,range:receipt.material.pageRange,pageAfter:receipt.pageAfter}));
      assert.deepEqual(receipt.material.pageRange,{current,start,end,total:7});
      for(let n=1;n<=7;n++)assert.equal(receipt.material.text.includes('BOOK_PAGE_'+n),n>=start&&n<=end);
      assert.equal(receipt.material.pdfBase64,undefined);
      assert.equal(receipt.pageAfter,current);assert.equal(receipt.requests,0);
      checks.push({pdfCurrentPage:current,pageRange:[start,end],wholeBook:false,automaticRequests:0});
    }
    const panel=window.frameLocator('iframe.note-chat-frame');
    await panel.locator('#readPage').click();
    await panel.locator('.material-chip').waitFor();
    assert.ok((await panel.locator('.material-chip').textContent()).includes('6–7'));
    await window.screenshot({path:path.join(project,'artifacts/obsidian-pdf-window.png')});
    await panel.locator('.material-chip button').click();
    // Exercise the real settings controls, persisted host preferences and the
    // actual PDF reader together, without signing in or sending any messages.
    for(const [mode,start,end] of [['current',4,4],['window',2,4],['all',1,7]]) {
      await panel.locator('#settings').click();
      await panel.locator('#pdfReadMode').selectOption(mode);
      if(mode==='window') {
        await panel.locator('#pdfBefore').fill('2');await panel.locator('#pdfBefore').press('Tab');
        await panel.locator('#pdfAfter').fill('0');await panel.locator('#pdfAfter').press('Tab');
      }
      await window.waitForFunction(mode=>app.plugins.plugins['note-chat-sidebar'].data.uiPrefs?.pdfRead?.mode===mode,mode);
      if(mode==='window')await window.waitForFunction(()=>{const o=app.plugins.plugins['note-chat-sidebar'].data.uiPrefs.pdfRead;return o.before===2&&o.after===0;});
      await panel.locator('[data-close="settingsDialog"]').click();
      const receipt=await window.evaluate(async ({pdfLeaf})=>{
        const plugin=app.plugins.plugins['note-chat-sidebar'];
        app.workspace.setActiveLeaf(pdfLeaf,{focus:true});
        pdfLeaf.view.viewer.child.pdfViewer.pdfViewer.currentPageNumber=4;
        plugin.trackNote();await plugin.activate();
        return {material:await plugin.noteMaterial(),requests:plugin.requests.size};
      },{pdfLeaf});
      assert.deepEqual(receipt.material.pageRange,{start,end,current:4,total:7});
      assert.equal(receipt.material.pdfMode,mode);assert.equal(receipt.requests,0);
      for(let n=1;n<=7;n++)assert.equal(receipt.material.text.includes('BOOK_PAGE_'+n),n>=start&&n<=end);
      await panel.locator('#readPage').click();await panel.locator('.material-chip').waitFor();
      assert.ok((await panel.locator('.material-chip').textContent()).includes(mode==='all'?'全文':start+'–'+end));
      await panel.locator('.material-chip button').click();
      checks.push({pdfMode:mode,pageRange:[start,end],persistedSettings:true,automaticRequests:0});
      console.log('Real PDF setting passed:',mode,start,end);
    }
    await panel.locator('#settings').click();
    await window.screenshot({path:path.join(project,'artifacts/obsidian-pdf-settings.png')});
    await panel.locator('[data-close="settingsDialog"]').click();
    // Restore a fixture history through the real host storage path, offline.
    // An optional local report is never copied into tracked fixtures or packages.
    const mathSample=process.env.NOTE_CHAT_MATH_REPORT
      ?JSON.parse(await fs.readFile(process.env.NOTE_CHAT_MATH_REPORT,'utf8')).content
      :await fs.readFile(path.join(project,'tests/fixtures/math-response.md'),'utf8');
    const expectedMath=process.env.NOTE_CHAT_MATH_REPORT?20:9;
    await window.evaluate(async content=>{
      const plugin=app.plugins.plugins['note-chat-sidebar'];
      const chat={id:'math-regression',title:'公式排版测试',created:Date.now(),updated:Date.now(),messages:[{role:'assistant',content}],draft:''};
      await plugin.serialize(()=>plugin.storage.set({['chat:'+chat.id]:chat,chatStore:{version:2,active:chat.id,chats:[{...chat,summary:true,messageCount:1,blank:false,messages:undefined}]}}));
      for(const leaf of app.workspace.getLeavesOfType('note-chat-sidebar-view'))await leaf.detach();
      await plugin.activate();
    },mathSample);
    await panel.locator('.message.assistant .katex').first().waitFor();
    assert.equal(await panel.locator('.message.assistant .katex').count(),expectedMath);
    assert.equal(await panel.locator('.math-error,.message.assistant h1').count(),0);
    assert.equal(await window.evaluate(()=>app.plugins.plugins['note-chat-sidebar'].requests.size),0);
    await panel.locator('#messages').evaluate(el=>{el.scrollTop=0;});
    await window.screenshot({path:path.join(project,'artifacts/obsidian-math-formulas.png')});
    const formulaBodies=panel.locator('.math-display');
    await formulaBodies.nth(2).scrollIntoViewIfNeeded();
    await window.screenshot({path:path.join(project,'artifacts/obsidian-math-equals.png')});
    checks.push({mathFormulas:expectedMath,noSpuriousHeadings:true,reopenedHistory:true,automaticRequests:0});
    await fs.writeFile(path.join(project,'artifacts','obsidian-selection-results.json'),JSON.stringify({checks,directory,realObsidian:true},null,2));
    console.log(JSON.stringify(checks));
  } catch(error) {
    if(context) {
      const windows=context.pages();if(windows[0])await windows[0].screenshot({path:path.join(project,'artifacts','obsidian-selection-failure.png')}).catch(()=>{});
    }
    throw error;
  } finally {
    if(context)await context.pages()[0]?.evaluate(() => window.electron?.remote?.app.quit()).catch(()=>{});
    if(browser)await browser.close();
    if(processHandle&&!processHandle.killed)processHandle.kill();
  }
})().catch(error => {console.error(error);process.exitCode=1;});
