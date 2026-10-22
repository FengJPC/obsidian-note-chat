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
  const pdf = await PDFDocument.create(), pdfPage = pdf.addPage([600,800]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdfPage.drawText('Later PDF tab: selected quantum research text.', {x:40,y:720,size:16,font});
  await fs.writeFile(path.join(vault,'paper.pdf'), await pdf.save());
  await fs.writeFile(path.join(profile,'obsidian.json'), JSON.stringify({vaults:{'ab1234ef5678abcd':{path:vault,ts:Date.now(),open:true}}}));
  const runtime = 'obsidian-1.14.4.asar';
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
