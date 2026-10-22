// Two live pages, real chat persistence protocol and real UI; synthetic account/model.
const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),obs=fs.existsSync(path.join(root,'src/ui-document.js'));
(async()=>{
 const {chatAction}=await import(obs?'../src/shared/chats.js':'../extension/chats.js');
 const oldMessages=[{role:'user',content:'earlier question'},{role:'assistant',content:'earlier answer'}];
 const state={credential:{name:'Fixture'},modelCatalog:[{id:'fixture',name:'Fixture'}],selectedModel:'fixture',chatStore:{version:1,active:'chat',chats:[{id:'chat',title:'Concurrent test',messages:oldMessages,draft:'',created:1,updated:1}]}};
 const until=async(check,label)=>{const deadline=Date.now()+10000;while(!check()){if(Date.now()>deadline)throw new Error('Timed out: '+label);await new Promise(r=>setTimeout(r,20));}};
 const fullStore=()=>({...state.chatStore,chats:state.chatStore.chats.map(c=>state['chat:'+c.id]||c)});
 const pages=[],errors=[],streams=[],requests=[];let queue=Promise.resolve(),holdB=false,releaseB,heldB=false;
 const storage={get:async keys=>Object.fromEntries((typeof keys==='string'?[keys]:keys).map(k=>[k,structuredClone(state[k])])),set:async data=>{
  const changes={};for(const [k,v]of Object.entries(data)){changes[k]={oldValue:state[k],newValue:v};state[k]=structuredClone(v);}
  await Promise.all(pages.filter(p=>!p.isClosed()).map(p=>p.evaluate(changes=>window.deliver?.({type:'storageChanged',changes,area:'local'}),changes)));
 },remove:async keys=>{for(const k of typeof keys==='string'?[keys]:keys)delete state[k];}};
 let documentHTML;
 if(obs){const {uiDocument}=await import('../src/ui-document.js'),runtime=path.join(root,'dist/note-chat-sidebar');documentHTML=uiDocument({html:fs.readFileSync(path.join(runtime,'ui.html'),'utf8'),script:fs.readFileSync(path.join(runtime,'ui.js'),'utf8'),css:fs.readFileSync(path.join(runtime,'ui.css'),'utf8'),katexCss:fs.readFileSync(path.join(runtime,'katex.css'),'utf8'),base:'http://127.0.0.1/',channel:'concurrency'});}
 const outer=`<iframe id="panel" style="width:460px;height:900px" sandbox="allow-scripts allow-same-origin"></iframe><script>
 window.deliver=m=>document.querySelector('iframe').contentWindow.postMessage({channel:'concurrency',...m},'*');
 window.addEventListener('message',async e=>{const m=e.data;if(e.source!==document.querySelector('iframe').contentWindow||m?.channel!=='concurrency'||!m.rpcId)return;try{deliver({type:'rpcResult',rpcId:m.rpcId,result:await fixtureRPC(m)})}catch(error){deliver({type:'rpcResult',rpcId:m.rpcId,result:{ok:false,error:error.message}})}});
 fetch('/document').then(r=>r.text()).then(t=>document.querySelector('iframe').srcdoc=t);</script>`;
 const server=http.createServer((req,res)=>{
  if(obs){res.setHeader('Content-Type','text/html;charset=utf-8');res.end(req.url==='/document'?documentHTML:outer);return;}
  const file=path.resolve(root,'extension','.'+decodeURI(req.url.split('?')[0]));if(!file.startsWith(path.join(root,'extension')+path.sep)){res.writeHead(403);res.end();return;}
  try{res.setHeader('Content-Type',/\.m?js$/.test(file)?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html':'application/octet-stream');res.end(fs.readFileSync(file));}catch{res.writeHead(404);res.end();}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));server.unref();
 const browser=await chromium.launch({executablePath:process.env.EDGE_EXECUTABLE_PATH||path.join(process.env['ProgramFiles(x86)']||'C:/Program Files (x86)','Microsoft/Edge/Application/msedge.exe'),headless:true});
 const context=await browser.newContext();
 try{
  async function open(label){
   const page=await context.newPage();pages.push(page);page.on('pageerror',e=>errors.push(e.message));await page.route('https://**/*',r=>r.abort());
   await page.exposeFunction('fixtureRPC',async m=>{
    let result={};
    if(m.type==='get')result={values:await storage.get(m.keys)};
    else if(m.type==='set')await storage.set(m.values);
    else if(m.type==='remove')await storage.remove(m.keys);
    else if(m.type==='chats'){
     if(label==='B'&&holdB&&m.action.op==='save'){heldB=true;await new Promise(r=>releaseB=r);}
     const job=queue.then(()=>chatAction(storage,m.action));queue=job.catch(()=>{});result=await job;
    }else if(m.type==='accounts')result={registry:{accounts:[]}};
    else if(m.type==='models')result={models:state.modelCatalog};
    else if(m.type==='webDiagnostics')result={log:{records:[]}};
    else if(m.type==='token')result={token:'fixture-only'};
    else if(m.type==='response'){requests.push(m.payload);streams.push({page,id:m.requestId});result={status:200};}
    return {ok:true,...result};
   });
   if(!obs)await page.addInitScript(()=>{
    const listeners=[],streams=new Map();
    window.deliver=m=>{if(m.type==='storageChanged')listeners.forEach(f=>f(m.changes,'local'));if(m.type==='streamChunk')streams.get(m.requestId)?.enqueue(Uint8Array.from(m.chunk));if(m.type==='streamEnd'){streams.get(m.requestId)?.close();streams.delete(m.requestId);}};
    window.chrome={runtime:{sendMessage:m=>fixtureRPC(m)},storage:{local:{get:async keys=>(await fixtureRPC({type:'get',keys})).values,set:values=>fixtureRPC({type:'set',values}),remove:keys=>fixtureRPC({type:'remove',keys})},onChanged:{addListener:f=>listeners.push(f)}},tabs:{getCurrent:async()=>null},windows:{getCurrent:async()=>({id:1})}};
    const original=fetch;window.fetch=async(url,options)=>{if(!String(url).endsWith('/responses'))return original(url,options);const requestId=crypto.randomUUID();const body=new ReadableStream({start(c){streams.set(requestId,c);},cancel(){streams.delete(requestId);}});await fixtureRPC({type:'response',requestId,payload:JSON.parse(options.body)});return {ok:true,status:200,body};};
   });
   await page.goto('http://127.0.0.1:'+server.address().port+(obs?'/':'/sidepanel.html'));
   const frame=obs?await (async()=>{await page.frameLocator('#panel').locator('#prompt').waitFor();return page.frames().find(f=>f.parentFrame());})():page;
   await frame.waitForFunction(()=>!document.getElementById('send').disabled&&document.getElementById('model').value==='fixture');
   return {page,frame};
  }
  const a=await open('A'),b=await open('B');console.log('Two windows ready');
  await a.frame.evaluate(()=>{window.firstArticle=document.querySelector('.message');window.replacements=0;new MutationObserver(ms=>{window.replacements+=ms.reduce((n,m)=>n+[...m.addedNodes].filter(x=>x.nodeName==='ARTICLE').length,0);}).observe(document.getElementById('messages'),{childList:true});});
  holdB=true;await b.frame.locator('#prompt').fill('B unsent draft');
  await new Promise((resolve,reject)=>{const start=Date.now(),timer=setInterval(()=>{if(heldB){clearInterval(timer);resolve();}else if(Date.now()-start>5000){clearInterval(timer);reject(new Error('B save did not start'));}},20);});
  await a.frame.locator('#prompt').fill('A question');await a.frame.locator('#send').click();
  await a.frame.waitForFunction(()=>!document.getElementById('stop').hidden);
  await until(()=>streams.length,'model request');
  const c=await open('C');assert.equal(fullStore().chats[0].messages.at(-1).failed,undefined);await c.page.close();
  let stream=streams[0];
  async function emit(events,end=false){await stream.page.evaluate(m=>deliver(m),{type:'streamChunk',requestId:stream.id,chunk:Array.from(Buffer.from(events.map(e=>'data: '+JSON.stringify(e)+'\n\n').join('')))});if(end)await stream.page.evaluate(m=>deliver(m),{type:'streamEnd',requestId:stream.id});}
  await emit(Array.from({length:150},()=>({type:'response.output_text.delta',delta:'word '})));
  await a.frame.waitForFunction(()=>document.querySelector('.message:last-child .body').textContent.includes('word'));
  assert.equal(await a.frame.evaluate(()=>window.firstArticle===document.querySelector('.message')),true);
  assert.ok(await a.frame.evaluate(()=>window.replacements<20),'stream deltas should batch into animation frames');
  await emit([{type:'response.completed',response:{output:[{type:'message',role:'assistant',content:[{type:'output_text',text:'A complete answer'}]}]}}],true);
  await a.frame.waitForFunction(()=>document.getElementById('requestStatus').textContent==='回答完成');
  console.log('Answer completed, releasing stale draft');holdB=false;releaseB();await b.frame.waitForFunction(()=>document.querySelector('.message:last-child .body').textContent.trim()==='A complete answer');
  assert.equal(fullStore().chats.length,1);assert.equal(fullStore().chats[0].draft,'B unsent draft');assert.equal(fullStore().chats[0].messages.length,4);
  assert.equal(await a.frame.locator('#prompt').inputValue(),'B unsent draft');
  // A busy/dirty peer must preserve its local text until a conflict receipt forks it.
  holdB=true;heldB=false;await b.frame.locator('#prompt').fill('B conflicting draft');
  await until(()=>heldB,'conflicting draft save');
  await a.frame.locator('#prompt').fill('A conflicting draft');await a.frame.waitForFunction(()=>document.getElementById('prompt').value==='A conflicting draft');
  await until(()=>fullStore().chats[0].draft==='A conflicting draft','A draft persisted');
  holdB=false;releaseB();await b.frame.waitForFunction(()=>document.getElementById('chatTitle').textContent.includes('冲突副本'));
  assert.deepEqual(fullStore().chats.map(c=>c.draft).sort(),['A conflicting draft','B conflicting draft']);
  for(const chat of fullStore().chats)assert.equal(chat.messages.at(-1).content,'A complete answer');
  await b.page.reload();const reloaded=obs?b.page.frameLocator('#panel'):b.page;await reloaded.locator('#prompt').waitFor();
  await (obs?b.page.frames().find(f=>f.parentFrame()):b.page).waitForFunction(()=>document.getElementById('prompt').value==='B conflicting draft');
  const history=structuredClone(fullStore()),original=history.chats.find(c=>c.id==='chat');
  original.context=[{role:'user',content:'OLD_MARKER '+('old '.repeat(70000))},{role:'assistant',content:'old answer'},{role:'user',content:'retained question'},{role:'assistant',content:'retained answer'}];original.revision++;
  await storage.set({['chat:'+original.id]:original});await a.frame.locator('#prompt').fill('budget question');await a.frame.locator('#send').click();
  await until(()=>streams.length===2,'budgeted request');stream=streams[1];
  assert.ok(!JSON.stringify(requests[1].input).includes('OLD_MARKER'));assert.ok(JSON.stringify(requests[1].input).includes('retained question'));
  await emit([{type:'response.completed',response:{output:[{type:'message',role:'assistant',content:[{type:'output_text',text:'Budgeted answer'}]}]}}],true);
  await a.frame.waitForFunction(()=>document.getElementById('requestStatus').textContent.includes('已省略 1 轮'));
  const count=fullStore().chats.find(c=>c.id==='chat').messages.length;
  await a.frame.locator('#prompt').fill('汉'.repeat(90000));await a.frame.locator('#send').click();
  await a.frame.waitForFunction(()=>document.getElementById('requestStatus').textContent.includes('超过上下文预算'));
  assert.equal((await a.frame.locator('#prompt').inputValue()).length,90000);assert.equal(requests.length,2);assert.equal(fullStore().chats.find(c=>c.id==='chat').messages.length,count);
  // An actual document close must release ownership and preserve checkpointed text.
  await a.frame.locator('#prompt').fill('close-window checkpoint');await a.frame.locator('#send').click();
  await until(()=>streams.length===3,'checkpoint request');stream=streams[2];
  await emit([{type:'response.output_text.delta',delta:'CHECKPOINTED_PARTIAL_ANSWER'}]);
  await until(()=>fullStore().chats.find(c=>c.id==='chat').messages.at(-1).content==='CHECKPOINTED_PARTIAL_ANSWER','checkpoint persisted');
  await b.page.evaluate(()=>fixtureRPC({type:'chats',action:{op:'select',id:'chat',compact:true}}));const alive=await open('Alive peer');await alive.frame.waitForFunction(()=>document.querySelector('.message:last-child .body').textContent.includes('CHECKPOINTED_PARTIAL_ANSWER'));
  assert.equal(fullStore().chats.find(c=>c.id==='chat').messages.at(-1).failed,undefined);await alive.page.close();
  await a.page.close();await b.page.evaluate(()=>fixtureRPC({type:'chats',action:{op:'select',id:'chat',compact:true}}));
  const reopened=await open('Reopened');await until(()=>fullStore().chats.find(c=>c.id==='chat').messages.at(-1).failed===true,'interrupted recovery');
  assert.equal(fullStore().chats.find(c=>c.id==='chat').messages.at(-1).content,'CHECKPOINTED_PARTIAL_ANSWER');
  await reopened.frame.waitForFunction(()=>document.querySelector('.message:last-child').classList.contains('failed'));
  assert.deepEqual(errors,[]);
  const report={passed:true,checks:['Stale draft and completed answer merge across two live windows','Opening a third window preserves the in-progress answer','Completed message DOM remains stable; 150 deltas batch into fewer than 20 article updates','Both conflicting drafts and full history survive, including reload','Partial answers survive a real page close and recover without interrupting live peers','Old context is trimmed in the dispatched request; an oversized current draft is retained without sending'],requests:requests.length};
  fs.mkdirSync(path.join(root,'artifacts'),{recursive:true});fs.writeFileSync(path.join(root,'artifacts/concurrency-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
 }catch(e){console.error('UI errors:',errors);for(const page of pages.filter(p=>!p.isClosed())){for(const frame of page.frames())console.error((await frame.locator('body').innerText().catch(()=>'' )).slice(-1500));}console.error('Chats:',JSON.stringify(state.chatStore));throw e;}finally{await browser.close();server.close();}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
