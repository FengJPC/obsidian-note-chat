// Optional live public-network smoke test. Uses two fixed public sample URLs,
// an isolated headless browser and the real host downloader/PDF parser. No login.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {build}=require('esbuild'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
(async()=>{
 const {downloadPublic}=await import('../src/public-network.js'),{uiDocument}=await import('../src/ui-document.js');
 const bundle=await build({stdin:{contents:"export {readPublic} from './src/ui/public-reader.js';",resolveDir:root},bundle:true,write:false,platform:'browser',format:'iife',globalName:'PublicReader',target:'chrome110',define:{process:'undefined','import.meta.url':'"about:blank"'},plugins:[{name:'raw-worker',setup(b){b.onResolve({filter:/\?raw$/},args=>({path:path.resolve(args.resolveDir,args.path.slice(0,-4)),namespace:'raw'}));b.onLoad({filter:/.*/,namespace:'raw'},async args=>({contents:fs.readFileSync(args.path,'utf8'),loader:'text'}));}}]});
 const document=uiDocument({html:'<head><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\' blob:; worker-src blob:; connect-src blob:; base-uri *;"></head><body><script src="ui.js"></script></body>',script:bundle.outputFiles[0].text,css:'',katexCss:'',base:'http://127.0.0.1/',channel:'public-probe'});
 const outer=`<!doctype html><iframe id="probe" sandbox="allow-scripts allow-same-origin"></iframe><script>
 addEventListener('message',async e=>{const m=e.data;if(e.source!==document.getElementById('probe').contentWindow||m.channel!=='public-probe'||!m.rpcId)return;let result;try{result={ok:true,...await window.host(m)}}catch(error){result={ok:false,error:error.message}}e.source.postMessage({channel:'public-probe',type:'rpcResult',rpcId:m.rpcId,result},'*')});fetch('/frame').then(r=>r.text()).then(t=>document.getElementById('probe').srcdoc=t);</script>`;
 const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html;charset=utf-8');res.end(req.url==='/frame'?document:outer);});await new Promise(r=>server.listen(0,'127.0.0.1',r));server.unref();
 const browser=await chromium.launch({executablePath:process.env.EDGE_EXECUTABLE_PATH||path.join(process.env['ProgramFiles(x86)']||'C:/Program Files (x86)','Microsoft/Edge/Application/msedge.exe'),headless:true});
 const pending=new Map();
 try{
  const page=await browser.newPage();await page.exposeFunction('host',async msg=>{
   if(msg.type==='cancelPublicRead'){pending.get(msg.requestId)?.abort();return {};}
   if(msg.type!=='publicRead')throw Error('Unexpected probe RPC');const controller=new AbortController();pending.set(msg.requestId,controller);
   try{return await downloadPublic(msg.url,{signal:controller.signal});}finally{pending.delete(msg.requestId);}
  });await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>document.getElementById('probe').contentWindow.PublicReader);
  const results=[];
  for(const url of ['https://example.com/','https://mozilla.github.io/pdf.js/web/compressed.tracemonkey-pldi-09.pdf']){
   const result=await page.evaluate(async url=>{const r=await document.getElementById('probe').contentWindow.PublicReader.readPublic(url);return {url,status:r.status,http_status:r.http_status,content_kind:r.content_kind,downloaded_bytes:r.downloaded_bytes,extracted_chars:r.extracted_chars,stored_chars:r.text?.length,page_count:r.page_count,pages_read:r.pages_read,error:r.error_message};},url);
   results.push(result);console.log(JSON.stringify(result));assert.ok(['success','partial'].includes(result.status));assert.ok(result.stored_chars>100);
  }
  fs.mkdirSync(path.join(root,'artifacts'),{recursive:true});fs.writeFileSync(path.join(root,'artifacts/public-live-results.json'),JSON.stringify({tested_at:new Date().toISOString(),results},null,2));
 }finally{for(const c of pending.values())c.abort();await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
