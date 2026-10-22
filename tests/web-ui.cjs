// Real bundled iframe/bridge/parser/UI, synthetic model and public-download receipts.
// No real account, user vault or model quota is used.
const {chromium}=require('playwright');
const {PDFDocument,StandardFonts}=require('pdf-lib');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),runtime=path.join(root,'dist/note-chat-sidebar');
(async()=>{
 const {uiDocument}=await import('../src/ui-document.js');
 const {chatAction}=await import('../src/shared/chats.js');
 const {diagnosticAction}=await import('../src/shared/web-diagnostics.js');
 const {publicUrl}=await import('../src/shared/public-sources.js');
 const pdf=await PDFDocument.create(),pdfPage=pdf.addPage();pdfPage.drawText('PUBLIC PDF quantum many-body scars.',{x:30,y:700,font:await pdf.embedFont(StandardFonts.Helvetica)});
 const pdfBytes=Buffer.from(await pdf.save()),errors=[],checks=[],requests=[],exports=[],downloads=[],toolResults=[];
 let mode='hosted',round=0,reads=0,pendingRead,clipboard='';
 const saved={credential:{name:'Fixture'},modelCatalog:[{id:'fixture-model',name:'Fixture model'}],selectedModel:'fixture-model'};
 const html=uiDocument({html:fs.readFileSync(path.join(runtime,'ui.html'),'utf8'),script:fs.readFileSync(path.join(runtime,'ui.js'),'utf8'),css:fs.readFileSync(path.join(runtime,'ui.css'),'utf8'),katexCss:fs.readFileSync(path.join(runtime,'katex.css'),'utf8'),base:'http://127.0.0.1/ui.html',channel:'web-fixture'});
 const outer=`<!doctype html><style>body{margin:0}iframe{display:block;width:460px;height:920px;border:0}</style><iframe id="panel" sandbox="allow-scripts allow-same-origin"></iframe><script>
 window.deliver=m=>document.getElementById('panel').contentWindow.postMessage({channel:'web-fixture',...m},'*');
 window.addEventListener('message',async e=>{const m=e.data;if(e.source!==document.getElementById('panel').contentWindow||m?.channel!=='web-fixture'||!m.rpcId)return;try{deliver({type:'rpcResult',rpcId:m.rpcId,result:{ok:true,...await window.fixtureRPC(m)}})}catch(error){deliver({type:'rpcResult',rpcId:m.rpcId,result:{ok:false,error:error.message}})}});
 fetch('/document').then(r=>r.text()).then(t=>document.getElementById('panel').srcdoc=t);</script>`;
 const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html;charset=utf-8');res.end(req.url==='/document'?html:outer);});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));server.unref();fs.mkdirSync(path.join(root,'artifacts'),{recursive:true});
 const browser=await chromium.launch({executablePath:process.env.EDGE_EXECUTABLE_PATH||path.join(process.env['ProgramFiles(x86)']||'C:/Program Files (x86)','Microsoft/Edge/Application/msedge.exe'),headless:true});
 const page=await browser.newPage({viewport:{width:460,height:920}});page.on('pageerror',e=>errors.push(e.message));
 let unexpectedNetwork=0;await page.route('https://**/*',route=>{unexpectedNetwork++;return route.abort();});
 const storage={get:async keys=>Object.fromEntries((typeof keys==='string'?[keys]:keys).map(k=>[k,structuredClone(saved[k])])),set:async values=>{
  const changes={};for(const [k,v]of Object.entries(values)){changes[k]={oldValue:saved[k],newValue:v};saved[k]=structuredClone(v);}await page.evaluate(changes=>deliver({type:'storageChanged',area:'local',changes}),changes);
 },remove:async keys=>{for(const k of typeof keys==='string'?[keys]:keys)delete saved[k];}};
 const base='https://example.com/',article=base+'article',pdfUrl=base+'paper.pdf';
 const articleText='PUBLIC_BODY_SENTINEL\n'+('Before output token limit. '+'x'.repeat(450)+'\n').repeat(35);
 const fc=(name,args,id)=>({type:'function_call',call_id:id,name,namespace:'public_web',arguments:JSON.stringify(args)});
 const message=text=>({type:'message',role:'assistant',content:[{type:'output_text',text}]});
 const active=()=>saved.chatStore.chats.find(c=>c.id===saved.chatStore.active);
 async function stream(id,events){for(const e of events){const bytes=Buffer.from('data: '+JSON.stringify(e)+'\n\n');for(let n=0;n<bytes.length;n+=173)await page.evaluate(m=>deliver(m),{type:'streamChunk',requestId:id,chunk:Array.from(bytes.subarray(n,n+173))});}await page.evaluate(m=>deliver(m),{type:'streamEnd',requestId:id});}
 await page.exposeFunction('fixtureRPC',async m=>{
  if(m.type==='get')return {values:await storage.get(m.keys)};
  if(m.type==='set'){await storage.set(m.values);return {};}
  if(m.type==='remove'){await storage.remove(m.keys);return {};}
  if(m.type==='chats')return chatAction(storage,m.action);
  if(m.type==='webDiagnostics')return diagnosticAction(storage,m.action);
  if(m.type==='accounts')return {registry:{accounts:[],selected:''}};
  if(m.type==='models')return {models:saved.modelCatalog};
  if(['token','uiReady','cancelResponse'].includes(m.type))return {};
  if(m.type==='clipboard'){clipboard=m.text;return {};}
  if(m.type==='readNote'){reads++;return {material:{id:'note',name:'Local note.md',text:'LOCAL_NOTE_SENTINEL'}};}
  if(m.type==='exportFile'){exports.push(m);return {path:'AI 对话/'+m.name};}
  if(m.type==='cancelPublicRead'){pendingRead?.reject(new Error('Stopped'));pendingRead=null;return {};}
  if(m.type==='publicRead'){
   assert.equal(saved.uiPrefs.webSearch,true);assert.equal(saved.uiPrefs.publicRead,true);publicUrl(m.url);downloads.push(m.url);
   if(m.url.endsWith('/hold'))return new Promise((resolve,reject)=>{pendingRead={resolve,reject};});
   let type='text/html',status=200,body;
   if(m.url===article)body='<title>Quantum article</title><nav>NAV_SENTINEL</nav><article><p>'+articleText+'</p><math><semantics><annotation encoding="application/x-tex">E=mc^2</annotation></semantics></math><a href="/paper.pdf">Paper PDF</a><script>window.PUBLIC_INJECTION=true</script><img src="https://example.com/pixel"><iframe src="https://example.com/pixel"></iframe></article>';
   else if(m.url===pdfUrl){body=pdfBytes;type='application/pdf';}
   else if(m.url.endsWith('/blocked')){status=429;body='';}
   else if(m.url.endsWith('/redirect')){status=302;body='';}
   else if(m.url.endsWith('/captcha'))body='<title>Verify you are human</title><main>Unusual traffic from your computer network</main>';
   else if(m.url.endsWith('/shell'))body='<main>Please enable JavaScript</main>';
   else if(m.url.endsWith('/empty'))body='<script>nothing</script>';
   else if(m.url.endsWith('/bad.pdf')){body='NOT A PDF';type='application/pdf';}
   else {body='binary';type='application/octet-stream';}
   return {status,url:m.url,headers:{'content-type':type},bodyBase64:Buffer.from(body).toString('base64')};
  }
  if(m.type==='response'){
   requests.push(m.payload);round++;
   const recent=[];for(let i=m.payload.input.length-1;i>=0&&m.payload.input[i].type==='function_call_output';i--)recent.unshift(JSON.parse(m.payload.input[i].output));toolResults.push(...recent);
   if(mode==='unsupported')return {status:400,apiError:{message:'web_search is not supported for this model'}};
   let events,output=[];
   if(mode==='hosted'){
    assert.ok(m.payload.tools.some(t=>t.type==='web_search'));assert.ok(m.payload.include.includes('web_search_call.action.sources'));
    const text='搜索结果。\uE200cite\uE202turn0search0\uE201';
    events=[{type:'response.output_item.done',output_index:0,item:{type:'web_search_call',id:'ws_fixture',status:'completed',action:{type:'search',queries:['quantum fixture'],sources:[{url:article,title:'Quantum article'}]}}},
     {type:'response.output_item.added',output_index:1,item:{type:'message',role:'assistant',content:[]}},
     {type:'response.output_text.delta',output_index:1,content_index:0,delta:text},
     {type:'response.output_text.annotation.added',output_index:1,content_index:0,annotation:{type:'url_citation',start_index:5,end_index:text.length,url:article,title:'Quantum article'}},
     {type:'response.completed',response:{output:[]}}];
   }else if(mode==='read'){
    assert.ok(m.payload.tools.some(t=>t.name==='public_web'));
    if(round===1)output=[fc('read_url',{url:article,refresh:null},'article')];
    else if(round===2){const id=recent[0].source_id;assert.ok(recent[0].text.includes('PUBLIC_BODY_SENTINEL'));assert.equal(recent[0].next_offset,6000);output=[fc('find_in_source',{source_id:id,pattern:'output token limit'},'find'),fc('read_source',{source_id:id,offset:6000,length:12000},'chunk'),fc('read_url',{url:pdfUrl,refresh:null},'pdf'),fc('read_url',{url:article,refresh:null},'cached')];}
    else {assert.equal(recent[0].match_count,35);assert.equal(recent[1].offset,6000);assert.ok(recent[2].text.includes('quantum many-body scars'));assert.equal(recent[2].pages_read,1);assert.equal(recent[3].cached,true);output=[message('已读取网页和 PDF。公式：$E=mc^2$。')];}
   }else if(mode==='failures'){
    if(round===1)output=['blocked','redirect','captcha','shell','empty','bad.pdf','binary'].map((p,i)=>fc('read_url',{url:base+p,refresh:null},'fail'+i));
    else {assert.deepEqual(recent.map(r=>r.status),['blocked','fetch_error','blocked','partial','parse_error','parse_error','parse_error']);output=[message('这些资料未完整读取，不能声称已核实。')];}
   }else if(mode==='stop')output=[fc('read_url',{url:base+'hold',refresh:null},'hold')];
   else {assert.equal(m.payload.tools?.some(t=>t.type==='web_search'||t.name==='public_web')||false,false);output=[message('普通聊天完成')];}
   if(!events)events=[...output.map((item,output_index)=>({type:'response.output_item.done',output_index,item})),{type:'response.completed',response:{output:[]}}];
   setTimeout(()=>stream(m.requestId,events).catch(e=>errors.push(e.message)),20);return {status:200};
  }
  throw Error('Unknown fixture '+m.type);
 });
 const frame=()=>page.frameLocator('#panel');
 async function ready(){await page.waitForFunction(()=>{const d=document.getElementById('panel').contentDocument;return d?.getElementById('model')?.value==='fixture-model'&&!d.getElementById('send').disabled;});}
 async function say(text){round=0;await frame().locator('#prompt').fill(text);await frame().locator('#send').click();await page.waitForFunction(()=>{const d=document.getElementById('panel').contentDocument;return d.getElementById('stop').hidden&&/回答完成|不支持联网/.test(d.getElementById('requestStatus').textContent);},{},{timeout:30000});}
 try{
  await page.goto('http://127.0.0.1:'+server.address().port);await ready();assert.equal(await frame().locator('#webSearch').getAttribute('aria-pressed'),'false');
  await frame().locator('#webSearch').click();await say('搜索最新资料');
  assert.equal(reads,0);assert.equal(downloads.length,0);assert.equal(await frame().locator('.web-sources').getAttribute('open'),null);
  assert.equal(await frame().locator('.message.assistant .body a').getAttribute('href'),article);
  await frame().locator('.message.assistant .copy').click();assert.ok(clipboard.includes(article));assert.ok(!clipboard.includes('\uE200'));
  await frame().locator('.web-sources summary').click();await frame().locator('.web-sources[open]').waitFor();
  await frame().locator('#settings').click();await frame().locator('#export').click();assert.ok(exports.at(-1).content.includes('联网来源'));assert.ok(exports.at(-1).content.includes(article));
  await frame().locator('[data-close="settingsDialog"]').click();await page.reload();await ready();assert.equal(await frame().locator('.web-sources').getAttribute('open'),null);assert.equal(await frame().locator('#webSearch').getAttribute('aria-pressed'),'true');
  checks.push('Stream-only citation annotations render clickable links; copying/export/reload retain sources; source list starts collapsed');console.log("Passed:",checks.at(-1));
  await frame().locator('#settings').click();await frame().locator('#publicRead').check();await frame().locator('#language').selectOption('en');assert.ok((await frame().locator('#settingsDialog').innerText()).includes('Enhanced public reading'));
  await frame().locator('#language').selectOption('zh-CN');await frame().locator('[data-close="settingsDialog"]').click();
  await frame().locator('#newChat').click();mode='read';await say('读一下这篇论文 '+article);
  assert.equal(reads,0);assert.deepEqual(downloads,[article,pdfUrl]);assert.equal(active().publicSources.length,2);assert.ok(active().publicSources[0].text.includes('E=mc^2'));assert.ok(!active().publicSources[0].text.includes('NAV_SENTINEL'));assert.equal(active().publicSources[0].links[0].url,pdfUrl);assert.equal(unexpectedNetwork,0);
  await frame().locator('#settings').click();await frame().locator('#viewPublicSources').click();await frame().locator('#publicSourceList details summary').first().click();await frame().locator('#publicSourceList button').first().click();assert.ok(exports.at(-1).content.includes('PUBLIC PDF'));
  await page.screenshot({path:path.join(root,'artifacts/web-snapshots.png')});await frame().locator('[data-close="publicSourcesDialog"]').click();
  await frame().locator('#exportDiagnostics').click();for(let i=0;!exports.at(-1)?.name.startsWith('web-diagnostics-')&&i<100;i++)await new Promise(r=>setTimeout(r,20));const diag=JSON.parse(exports.at(-1).content);assert.ok(diag.records.flatMap(r=>r.local_calls).some(c=>c.submitted_output_chars>0));assert.ok(!exports.at(-1).content.includes('PUBLIC_BODY_SENTINEL'));
  await frame().locator('[data-close="settingsDialog"]').click();await page.screenshot({path:path.join(root,'artifacts/web-chat.png')});await page.reload();await ready();assert.equal(active().publicSources.length,2);
  checks.push('Public HTML/PDF extraction, formula/link preservation, find/chunk reads, cache reuse, snapshot persistence/TXT export and diagnostic redaction');console.log("Passed:",checks.at(-1));
  mode='failures';await frame().locator('#newChat').click();await say('读取无法访问的公开资料');assert.equal(round,2);
  checks.push('HTTP denial, redirect, CAPTCHA, JS shell, empty document, damaged PDF and unsupported content remain distinguishable');console.log("Passed:",checks.at(-1));
  mode='unsupported';const beforeUnsupported=requests.length;await say('尝试联网');assert.equal(requests.length,beforeUnsupported+1);assert.ok((await frame().locator('#requestStatus').textContent()).includes('不会自动重试'));
  assert.equal(saved.webDiagnostics.records.at(-1).api_http_status,400);assert.equal(saved.webDiagnostics.records.at(-1).outcome,'http_error');
  checks.push('Host HTTP errors survive the bridge, show manual retry instructions and record the real API status');console.log("Passed:",checks.at(-1));
  mode='stop';round=0;const beforeStop=requests.length;await frame().locator('#prompt').fill('读取并停止');await frame().locator('#send').click();
  for(let i=0;!pendingRead&&i<150;i++)await new Promise(r=>setTimeout(r,20));assert.ok(pendingRead);await frame().locator('#stop').click();await frame().locator('#stop').waitFor({state:'hidden'});assert.equal(requests.length,beforeStop+1);
  const stopped=saved.webDiagnostics.records.flatMap(r=>r.local_calls).at(-1);assert.equal(stopped.status,'stopped');assert.equal(stopped.submitted_output_chars,null);
  await frame().locator('#webSearch').click();mode='off';const beforeDownloads=downloads.length;await say('普通聊天');assert.equal(downloads.length,beforeDownloads);
  checks.push('Stopping cancels in-flight download without a follow-up API call; disabling Web removes both tools');console.log("Passed:",checks.at(-1));
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(root,'artifacts/web-ui-results.json'),JSON.stringify({ok:true,checks,requests:requests.length,downloads:downloads.length,errors},null,2));console.log(JSON.stringify({ok:true,checks},null,2));
 }catch(e){await page.screenshot({path:path.join(root,'artifacts/web-ui-failure.png')}).catch(()=>{});console.error('UI status:',await frame().locator('#requestStatus').textContent().catch(()=>''),errors);throw e;}
 finally{pendingRead?.reject(new Error('Test ended'));await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
