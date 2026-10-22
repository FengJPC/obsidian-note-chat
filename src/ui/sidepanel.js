import {t,setLanguage,captureUI} from './i18n.js';
import {transferFiles,isFileTransfer} from './attachment-transfer.js';
import {MATERIAL_POLICY,requestedMaterial,wantsFile,materialInput} from '../shared/materials.js';
import {uploadMaterial,obtainMaterial,decodeMaterial} from './material-ui.js';
import {API,sseEvents} from '../shared/core.js';
import {exportChat,isBlankChat,effortsFor,textFile,fileToolFor,fileLimitMB} from '../shared/chats.js';
import {generationWatch,recoverInterrupted} from '../shared/generation.js';
import {responseTurn} from '../shared/response-turn.js';
import {mathMarkdown,renderFormula} from './math.js';
async function mount(){
const $=id=>document.getElementById(id);
const translateStatic=captureUI(document.body);
let lastNotice='Enter 发送 · Shift+Enter 换行';
let materialBusy=false;
let store,chat,controller,connected=false,catalog=[],consumedDraft,undoChat,saveTimer;
let prefs={language:'zh-CN',theme:'system',fontSize:17,fileTools:true,fileLimit:1,efforts:{}};
async function rpc(type,extra={}){const r=await chrome.runtime.sendMessage({type,...extra});if(!r?.ok)throw new Error(r?.error||t('扩展后台没有回应。'));return r;}
function notice(text){lastNotice=text;$('requestStatus').textContent=t(text);}
async function mutate(action){const r=await rpc('chats',{action});store=r.store;return r;}
async function save(){if(!chat)return;const snapshot=structuredClone(chat);await mutate({op:'save',chat:snapshot});}
function scheduleSave(){clearTimeout(saveTimer);saveTimer=setTimeout(()=>save().catch(e=>notice(e.message)),300);}
function renderMaterials(){
 $('materials').replaceChildren();
 for(const m of chat?.materials||[]){const row=document.createElement('div');row.className='material-chip';
  if(/^data:image\/(jpeg|png|webp);base64,/.test(m.image||'')){const img=document.createElement('img');img.src=m.image;img.alt=t('待发送图片');row.append(img);}
  const name=document.createElement('span');name.textContent=m.name;name.title=m.text?.slice(0,300)||m.url||'';
  const remove=document.createElement('button');remove.className='subtle';remove.textContent='×';remove.title=t('移除待发送资料');remove.onclick=async()=>{if(!guard())return;chat.materials=chat.materials.filter(a=>a.id!==m.id);renderMaterials();await save();};row.append(name,remove);$('materials').append(row);
 }
}
async function stageMaterial(task){
 if(!guard())return;if((chat.materials||[]).length>=3)return notice('一次最多附带 3 份资料，请先移除或发送。');
 materialBusy=true;$('send').disabled=true;notice('正在准备资料…');
 try{const m=await task();chat.materials=[...(chat.materials||[]),m];renderMaterials();await save();notice('资料已放入草稿，发送时才交给 GPT');}
 catch(e){notice(e.message);}finally{materialBusy=false;$('send').disabled=!connected;}
}
async function stageFiles(files){
 if(!files.length||!guard())return;
 const slots=3-(chat.materials||[]).length;if(slots<=0)return notice('一次最多附带 3 份资料，请先移除或发送。');
 materialBusy=true;$('send').disabled=true;notice('正在准备附件…');let added=0;const errors=[];
 try{for(const file of files.slice(0,slots)){try{const m=await uploadMaterial(file);chat.materials=[...(chat.materials||[]),m];added++;}catch(e){errors.push(file.name+'：'+e.message);}}renderMaterials();await save();notice([added?t('已添加 ')+added+t(' 份资料，发送时才交给 GPT'):'',files.length>slots?t('一次最多 3 份，超出的附件未添加'):'',...errors].filter(Boolean).join('；'));}
 catch(e){notice(t('附件保存失败：')+e.message);}finally{materialBusy=false;$('send').disabled=!connected;}
}
function draftUI(){renderMaterials(); $('prompt').value=chat.draft||''; $('source').hidden=!chat.source; $('source').textContent=chat.source?t('选文来源：')+(chat.source.title||chat.source.url||t('当前页面')):'';resize();}
function selectActive(){chat=store.chats.find(c=>c.id===store.active)||store.chats[0];$('chatTitle').textContent=chat.title==='新对话'?t('新对话'):chat.title;draftUI();render(true);}
function resize(){$('prompt').style.height='auto';$('prompt').style.height=Math.min(170,$('prompt').scrollHeight)+'px';}
async function download(name,content){try{const r=await rpc('exportFile',{name,content});notice(t('已保存到笔记库：')+r.path);}catch(e){notice(e.message);}}
function exportOne(c){download(c.title.replace(/[\\/:*?"<>|]/g,'_').slice(0,80)+'.md',exportChat(c));}
function markdown(text){
 const {html,formulas}=mathMarkdown(text);const parsed=document.createElement('template');parsed.innerHTML=html;
 const allowed=new Set(['P','BR','STRONG','EM','DEL','UL','OL','LI','PRE','CODE','BLOCKQUOTE','H1','H2','H3','H4','HR','A','TABLE','THEAD','TBODY','TR','TH','TD']);
 function clean(node){if(node.nodeType===3)return document.createTextNode(node.textContent);if(node.nodeType!==1)return document.createTextNode('');if(node.tagName==='SPAN'&&formulas.has(node.dataset.formula))return renderFormula(formulas.get(node.dataset.formula));if(['SCRIPT','STYLE','IFRAME','IMG','OBJECT','SVG'].includes(node.tagName))return document.createTextNode('');const out=allowed.has(node.tagName)?document.createElement(node.tagName.toLowerCase()):document.createDocumentFragment();if(node.tagName==='A'){try{const u=new URL(node.getAttribute('href'));if(['https:','http:','mailto:'].includes(u.protocol)){out.href=u.href;out.target='_blank';out.rel='noreferrer noopener';}}catch{}}for(const n of node.childNodes)out.append(clean(n));return out;}
 const result=document.createDocumentFragment();for(const n of parsed.content.childNodes)result.append(clean(n));return result;
}
function atBottom(){const m=$('messages');return m.scrollHeight-m.scrollTop-m.clientHeight<85;}
function render(force=false){
 const bottom=force||atBottom(),position=$('messages').scrollTop;$('messages').replaceChildren();
 if(!chat.messages.length){const e=document.createElement('div');e.className='empty';const h=document.createElement('h1');h.textContent=t('把问题留在手边');const p=document.createElement('p');p.textContent=t('选中笔记文字，右键发送到这里。\n普通聊天不会自动读取笔记。');e.append(h,p);$('messages').append(e);}
 for(const m of chat.messages){const article=document.createElement('article');article.className='message '+m.role+(m.failed?' failed':'');const role=document.createElement('div');role.className='role';role.textContent=(m.role==='user'?t('你'):'GPT')+(m.failed?t(' · 未完成'):'');const copy=document.createElement('button');copy.className='copy';copy.textContent=t('复制');copy.onclick=()=>rpc('clipboard',{text:m.content||''}).then(()=>notice('已复制'),()=>notice('复制失败，请手动选择文字。'));role.append(copy);const body=document.createElement('div');body.className='body';if(m.role==='user')body.textContent=m.content;else body.append(markdown(m.content||(m.pending&&controller?t('正在思考…'):t('未返回文本。'))));for(const table of body.querySelectorAll('table')){const wrap=document.createElement('div');wrap.className='table-wrap';table.replaceWith(wrap);wrap.append(table);}if(m.role==='user')for(const part of m.inputContent||[])if(part.type==='input_image'&&/^data:image\/(jpeg|png|webp);base64,/.test(part.image_url||'')){const img=document.createElement('img');img.className='sent-image';img.src=part.image_url;img.alt=t('已发送图片');body.append(img);}article.append(role,body);if(m.files?.length){const list=document.createElement('div');list.className='attachments';for(const f of m.files){const b=document.createElement('button');b.className='attachment';b.textContent='↓ '+f.name+' · '+new TextEncoder().encode(f.content).length+t(' 字节');b.onclick=()=>download(f.name,f.content);list.append(b);}article.append(list);}$('messages').append(article);}
 if(bottom)$('messages').scrollTop=$('messages').scrollHeight;else $('messages').scrollTop=position;
 $('toBottom').hidden=bottom;
}
function applyPrefs(){setLanguage(prefs.language);document.documentElement.lang=prefs.language==='en'?'en':'zh-CN';document.title=t('伴读侧栏');translateStatic();$('language').value=prefs.language;notice(lastNotice);const dark=prefs.theme==='dark'||prefs.theme==='system'&&matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.dataset.theme=dark?'dark':'light';document.documentElement.style.setProperty('--font',prefs.fontSize+'px');$('themeSetting').value=prefs.theme;$('fontSize').value=String(prefs.fontSize);$('fileTools').checked=prefs.fileTools;$('fileLimit').value=String(fileLimitMB(prefs.fileLimit));}
async function savePrefs(){applyPrefs();await chrome.storage.local.set({uiPrefs:prefs});}
function effortUI(){const available=effortsFor(catalog.find(m=>m.id===$('model').value));$('effort').replaceChildren(new Option(t('模型默认'),''));const labels={none:t('不思考'),minimal:t('极低'),low:t('低'),medium:t('中等'),high:t('高'),xhigh:t('很高'),max:t('最高')};for(const e of available)$('effort').append(new Option(t('思考：')+labels[e],e));const chosen=prefs.efforts[$('model').value];if(available.includes(chosen))$('effort').value=chosen;$('effort').disabled=!!controller||!available.length;$('effort').title=available.length?t('更高强度通常更慢，也会增加用量'):t('该模型未提供已确认的强度选项，使用模型默认');}
function catalogUI(selected){$('model').replaceChildren(...catalog.map(m=>new Option(m.name,m.id)));if(catalog.some(m=>m.id===selected))$('model').value=selected;effortUI();}
async function models(){try{notice('正在读取模型…');const r=await rpc('models');catalog=r.models;const old=$('model').value||(await chrome.storage.local.get('selectedModel')).selectedModel;catalogUI(old);await chrome.storage.local.set({modelCatalog:catalog});notice('模型已更新');}catch(e){notice(e.message);}}
async function syncAccount(){const {credential:c,authStatus}=await chrome.storage.local.get(['credential','authStatus']);let registry={accounts:[],selected:''};try{registry=(await rpc('accounts')).registry;}catch(e){notice(e.message);}const choices=registry.accounts.map(a=>new Option((a.email||a.name||t('账号已连接'))+' · '+a.clientId.slice(-8),a.clientId));$('loginAccount').replaceChildren(...choices,new Option(t('连接其他账号/工作区（新登记）'),'__new__'));$('loginAccount').value=registry.selected||'__new__';$('loginAccountLabel').hidden=!!c||!choices.length;$('registrationNote').hidden=!!c||!choices.length;connected=!!c;$('accountName').textContent=c?c.email||c.name||t('账号已连接'):t('尚未连接');$('authStatus').textContent=t(authStatus||'请连接 ChatGPT 账号。');$('login').textContent=c?t('重新登录'):'Continue with ChatGPT';$('logout').hidden=!c;$('send').disabled=!connected||!!controller;if(!connected)notice('在右上角设置中连接 ChatGPT 账号');}
async function draft(){if(controller||materialBusy)return;const {selectionDraft:d}=await chrome.storage.local.get('selectionDraft');if(!d||d.id===consumedDraft||!chat)return;consumedDraft=d.id;chat.draft=($('prompt').value?$('prompt').value+'\n\n':'')+d.text;chat.source=d;draftUI();await save();const current=(await chrome.storage.local.get('selectionDraft')).selectionDraft;if(current?.id===d.id)await chrome.storage.local.remove('selectionDraft');$('prompt').focus();}
function guard(){if(controller||materialBusy){notice('请先停止当前回答。');return false;}return true;}
async function switchChat(id){if(!guard())return;clearTimeout(saveTimer);await save();await mutate({op:'select',id});selectActive();$('historyDialog').close();}
async function historyUI(){store=(await rpc('chats',{action:{op:'load'}})).store;const query=$('historySearch').value.toLowerCase();$('historyList').replaceChildren();for(const c of [...store.chats].sort((a,b)=>b.updated-a.updated)){if(!c.messages?.length)continue;if(query&&!([c.title,...c.messages.map(m=>m.content)].join('\n').toLowerCase().includes(query)))continue;const row=document.createElement('div');row.className='history-item'+(c.id===chat.id?' selected':'');const title=document.createElement('button');title.className='history-title';title.textContent=c.title==='新对话'?t('新对话'):c.title;title.onclick=()=>switchChat(c.id);const meta=document.createElement('div');meta.className='history-meta';meta.textContent=new Date(c.updated).toLocaleString(prefs.language)+' · '+(c.messages.length?c.messages.length+t(' 条消息'):t('未发送草稿'));const actions=document.createElement('div');actions.className='history-actions';for(const [name,fn] of [[t('重命名'),()=>{if(!guard())return;const input=document.createElement('input');input.className='rename-input';input.value=c.title;title.replaceWith(input);input.focus();input.select();input.onkeydown=async e=>{if(e.key==='Enter'){await mutate({op:'rename',id:c.id,title:input.value});if(chat.id===c.id){chat.title=input.value;$('chatTitle').textContent=chat.title==='新对话'?t('新对话'):chat.title;}historyUI();}if(e.key==='Escape')historyUI();};}],[t('导出 MD'),()=>exportOne(c)],[t('删除'),async()=>{if(!guard())return;const r=await mutate({op:'delete',id:c.id});undoChat=r.deleted;$('undo').hidden=!undoChat;if(chat.id===c.id)selectActive();historyUI();notice('已删除会话，可撤销');}]] ){const b=document.createElement('button');b.className='subtle';b.textContent=name;b.onclick=fn;actions.append(b);}row.append(title,meta,actions);$('historyList').append(row);}}
async function send(){
 if(controller||materialBusy||!connected)return;const text=$('prompt').value.trim()||(chat.materials?.length?'请查看我提供的资料。':''),model=$('model').value,effort=$('effort').value,fileTools=prefs.fileTools&&wantsFile(text),limit=fileLimitMB(prefs.fileLimit);if(!text)return;if(!model)return notice('请在设置中刷新并选择模型。');clearTimeout(saveTimer);
 const mode=requestedMaterial(text);if(mode&&!chat.materials?.length){materialBusy=true;$('send').disabled=true;notice(mode==='read'?t('正在读取资料…'):t('正在截图…'));try{chat.materials=[await obtainMaterial(mode)];renderMaterials();await save();}catch(e){notice(e.message);return;}finally{materialBusy=false;$('send').disabled=!connected;}}
 const input=structuredClone(chat.context||chat.messages.filter(m=>!m.failed&&m.content).map(m=>({role:m.role,content:m.inputContent||m.content})));
 const content=text+(chat.source?.url?'\n\n来源：'+chat.source.title+'\n'+chat.source.url:'');const inputContent=materialInput(content,chat.materials||[]);input.push({role:'user',content:inputContent});
 const user={role:'user',content:content+(chat.materials?.length?'\n\n资料：'+chat.materials.map(m=>m.name).join('、'):''),inputContent};const answer={role:'assistant',content:'',files:[],pending:true};chat.messages.push(user,answer);if(chat.title==='新对话')chat.title=text.replace(/\s+/g,' ').slice(0,30);$('chatTitle').textContent=chat.title==='新对话'?t('新对话'):chat.title;
 chat.draft='';chat.source=null;chat.materials=[];draftUI();controller=new AbortController();const signal=controller.signal;$('stop').hidden=false;$('send').disabled=true;for(const id of ['model','effort','fileTools','fileLimit','refreshModels'])$(id).disabled=true;render(true);notice('正在连接…');let complete=false;
 const watch=generationWatch(controller,{onTick:notice});
 const interrupted=new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('Stopped','AbortError')),{once:true}));
 interrupted.catch(()=>{});
 const wait=p=>Promise.race([p,interrupted]);
 try{await wait(save());await wait(rpc('token'));const token='host-managed';for(let round=0;round<5;round++){
 watch.progress('正在思考');const payload={model,input,instructions:MATERIAL_POLICY,store:false,stream:true,include:['reasoning.encrypted_content']};if(effort)payload.reasoning={effort};if(fileTools)payload.tools=[fileToolFor(limit)];
 const response=await fetch(API+'/responses',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(payload),signal});
 if(!response.ok){const body=await response.json().catch(()=>({}));throw new Error(t('请求失败：HTTP ')+response.status+(body.error?.message?' · '+body.error.message.slice(0,300):''));}
 let result,roundText='';const turn=responseTurn();watch.progress();
 for await(const e of sseEvents(response.body)){turn.accept(e);watch.progress();if(e.type==='response.output_text.delta'){roundText+=e.delta||'';answer.content+=e.delta||'';render();watch.progress('正在回答');notice('正在回答…');}if(e.type==='response.function_call_arguments.delta')watch.progress('正在准备文件');if(e.type==='response.completed'){result=e.response;break;}if(e.type==='response.failed'||e.type==='error')throw new Error(e.response?.error?.message||e.message||t('生成失败'));if(e.type==='response.incomplete')throw new Error(t('回答未完成'));}
 if(!result)throw new Error(t('连接中断，回答未完成；不会自动重发。'));const output=turn.output(result);input.push(...output);if(!roundText)answer.content+=output.filter(o=>o.type==='message').flatMap(o=>o.content||[]).filter(c=>c.type==='output_text').map(c=>c.text||'').join('');const calls=output.filter(o=>o.type==='function_call');if(!calls.length){complete=true;break;}
 watch.progress('正在生成文件');notice('正在生成文件…');for(const call of calls){let toolResult;try{if(!fileTools||!['create_text_file','files.create_text_file'].includes(call.name)||(call.namespace&&call.namespace!=='files'))throw new Error(t('未知或已关闭的工具'));if(answer.files.length>=10)throw new Error(t('一次回答最多生成 10 个文件'));const f=textFile(JSON.parse(call.arguments),limit);answer.files.push(f);toolResult={ok:true,filename:f.name,bytes:new TextEncoder().encode(f.content).length,download_available:true};}catch(e){toolResult={ok:false,error:e.message};}input.push({type:'function_call_output',call_id:call.call_id,output:JSON.stringify(toolResult)});}render();await wait(save());}
 if(!complete)throw new Error(t('已达到文件工具调用轮次限制'));if(!answer.content&&!answer.files.length)throw new Error(t('模型结束了请求，但没有返回文本或文件。'));chat.context=input;notice('回答完成');
 }catch(e){answer.failed=true;user.failed=true;const message=watch.timeout||(e.name==='AbortError'?t('已停止生成'):e.message);notice(message);if(!answer.content)answer.content=message;}
 finally{watch.close();answer.pending=false;controller=null;$('stop').hidden=true;$('send').disabled=!connected;for(const id of ['model','fileTools','fileLimit','refreshModels'])$(id).disabled=false;effortUI();render();await save().catch(e=>notice(t('回答已结束，但保存失败：')+e.message));await draft();}
}
$('prompt').oninput=()=>{chat.draft=$('prompt').value;resize();scheduleSave();};$('prompt').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();send();}};
$('send').onclick=send;$('stop').onclick=()=>controller?.abort();$('newChat').onclick=async()=>{if(!guard())return;clearTimeout(saveTimer);await save();await mutate({op:'new'});selectActive();notice('新对话');};
$('readPage').onclick=()=>stageMaterial(()=>obtainMaterial('read',true));
$('capturePage').onclick=()=>stageMaterial(()=>obtainMaterial('screenshot'));
$('upload').onclick=()=>{if(guard())$('uploadInput').click();};
$('uploadInput').onchange=()=>{const files=Array.from($('uploadInput').files);$('uploadInput').value='';stageFiles(files);};
const compose=document.querySelector('footer');
window.addEventListener('note-chat-material',event=>stageMaterial(()=>decodeMaterial(event.detail)));
document.getElementById('cancelLogin').onclick=()=>rpc('cancelLogin');
compose.addEventListener('paste',e=>{const files=transferFiles(e.clipboardData);if(!files.length)return;e.preventDefault();stageFiles(files);});
document.addEventListener('dragover',e=>{if(!isFileTransfer(e.dataTransfer))return;e.preventDefault();e.dataTransfer.dropEffect=compose.contains(e.target)?'copy':'none';compose.classList.toggle('drop-ready',compose.contains(e.target));});
document.addEventListener('dragleave',e=>{if(!compose.contains(e.relatedTarget))compose.classList.remove('drop-ready');});
document.addEventListener('drop',e=>{if(!isFileTransfer(e.dataTransfer))return;e.preventDefault();compose.classList.remove('drop-ready');if(compose.contains(e.target))stageFiles(transferFiles(e.dataTransfer));else notice('请把文件拖到输入框区域。');});
$('history').onclick=()=>{historyUI();$('historyDialog').showModal();};$('historySearch').oninput=historyUI;$('settings').onclick=()=>$('settingsDialog').showModal();document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>$(b.dataset.close).close());
$('undo').onclick=async()=>{if(!undoChat||!guard())return;await mutate({op:'restore',chat:undoChat});undoChat=null;$('undo').hidden=true;selectActive();notice('已恢复会话');};
$('language').onchange=async()=>{prefs.language=setLanguage($('language').value);await savePrefs();effortUI();render();draftUI();$('chatTitle').textContent=chat.title==='新对话'?t('新对话'):chat.title;await syncAccount();if($('historyDialog').open)await historyUI();};
$('theme').onclick=()=>{prefs.theme=document.documentElement.dataset.theme==='dark'?'light':'dark';savePrefs();};$('themeSetting').onchange=()=>{prefs.theme=$('themeSetting').value;savePrefs();};$('fontSize').onchange=()=>{prefs.fontSize=Number($('fontSize').value);savePrefs();};$('fileLimit').onchange=()=>{prefs.fileLimit=fileLimitMB($('fileLimit').value);savePrefs();};$('fileTools').onchange=()=>{prefs.fileTools=$('fileTools').checked;savePrefs();};matchMedia('(prefers-color-scheme: dark)').addEventListener('change',applyPrefs);
$('model').onchange=()=>{chrome.storage.local.set({selectedModel:$('model').value});effortUI();};$('effort').onchange=()=>{prefs.efforts[$('model').value]=$('effort').value;savePrefs();};$('refreshModels').onclick=models;$('export').onclick=()=>exportOne(chat);
$('login').onclick=async()=>{try{await rpc('login',{clientId:$('loginAccount').value});await syncAccount();}catch(e){notice(e.message);}};$('logout').onclick=async()=>{try{controller?.abort();await rpc('logout');await syncAccount();}catch(e){notice(e.message);}};
$('messages').onscroll=()=>$('toBottom').hidden=atBottom();$('toBottom').onclick=()=>{$('messages').scrollTop=$('messages').scrollHeight;};
Promise.all([Promise.resolve(null),Promise.resolve(null)]).then(([tab,win])=>{if(!tab)return;$('openSidebar').hidden=false;$('openSidebar').onclick=()=>chrome.sidePanel.open({windowId:win.id}).then(()=>notice('已向 Edge 请求打开侧栏'),e=>notice(t('侧栏打开失败：')+e.message));});
chrome.storage.onChanged.addListener((changes,area)=>{if(area!=='local')return;if(changes.credential||changes.authStatus){syncAccount();if(changes.credential?.newValue&&!changes.credential.oldValue)models();}if(changes.selectionDraft?.newValue)draft();if(changes.panelError?.newValue)notice(changes.panelError.newValue);});
const saved=await chrome.storage.local.get(['uiPrefs','modelCatalog','selectedModel']);prefs={...prefs,...saved.uiPrefs,efforts:saved.uiPrefs?.efforts||{}};prefs.language=setLanguage(prefs.language);applyPrefs();catalog=saved.modelCatalog||[];if(catalog.length)catalogUI(saved.selectedModel);store=(await rpc('chats',{action:{op:'load'}})).store;for(const c of [...store.chats])if(recoverInterrupted(c))await mutate({op:'save',chat:c});selectActive();await syncAccount();await draft();if(connected)models();

chrome.runtime.sendMessage({type:'uiReady'});

}
mount().catch(e=>{document.getElementById("requestStatus").textContent="侧栏启动失败："+e.message;console.error(e);});
