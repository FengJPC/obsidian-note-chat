import {mergeChat,same} from './chat-sync.js';
import {sourceMarkdown} from './web-search.js';
export function newChat(){return {id:crypto.randomUUID(),title:'新对话',created:Date.now(),updated:Date.now(),messages:[],draft:'',source:null};}
export function isBlankChat(c){return c.summary===true?c.blank:!c.messages?.length&&!c.context?.length&&!String(c.draft||'').trim()&&!c.source&&!c.materials?.length;}
export const chatKey=id=>'chat:'+id;
function summary(c){return {id:c.id,title:c.title,created:c.created,updated:c.updated,revision:c.revision||0,summary:true,blank:isBlankChat(c),messageCount:c.messages?.length||0};}
// The host serializes all operations. Commit bodies before their index and retain
// the complete legacy store as a backup; never silently replace a missing body.
export async function chatAction(storage,action){
 let store=(await storage.get(['chatStore'])).chatStore;
 if(store?.version!==2){
  const legacy=await storage.get(['chatStore','chatHistory','composer','composerSource']);store=legacy.chatStore;
  if(!store){const c=newChat();c.messages=legacy.chatHistory||[];c.draft=legacy.composer||'';c.source=legacy.composerSource||null;if(c.messages.length)c.title='之前的对话';store={version:1,active:c.id,chats:[c]};}
  if(!Array.isArray(store.chats)||!store.chats.length)throw new Error('聊天记录格式异常，已停止迁移。');
  const bodies=Object.fromEntries(store.chats.map(c=>[chatKey(c.id),c]));
  await storage.set({chatLegacyBackup:legacy,...bodies});
  for(const c of store.chats){const copy=(await storage.get([chatKey(c.id)]))[chatKey(c.id)];if(!same(copy,c))throw new Error('聊天迁移校验失败，旧记录已保留。');}
  store={version:2,active:store.active,chats:store.chats.map(summary)};
  await storage.set({chatStore:store});
  await storage.remove(['chatHistory','composer','composerSource']);
 }
 const previousIds=store.chats.map(c=>c.id),loaded=new Map(),writes={};let changed=false;
 async function read(id){if(!id)return undefined;if(loaded.has(id))return loaded.get(id);const c=(await storage.get([chatKey(id)]))[chatKey(id)];if(!c||c.id!==id||!Array.isArray(c.messages))throw new Error('会话正文缺失或损坏，已停止操作；请从备份恢复。');loaded.set(id,c);return c;}
 function put(c){loaded.set(c.id,c);writes[chatKey(c.id)]=c;const i=store.chats.findIndex(x=>x.id===c.id);if(i<0)store.chats.unshift(summary(c));else store.chats[i]=summary(c);changed=true;}
 let deleted,savedChatId,conflict=false;
 if(action.op==='new'){const existing=store.chats.find(c=>c.id===store.active&&isBlankChat(c))||store.chats.find(isBlankChat);const c=existing?await read(existing.id):newChat();put(c);store.active=c.id;}
 if(action.op==='select'&&store.chats.some(c=>c.id===action.id)&&store.active!==action.id){store.active=action.id;changed=true;}
 if(action.op==='save'){
  const current=store.chats.some(c=>c.id===action.chat.id)?await read(action.chat.id):undefined;
  if(action.chat.summary||!Array.isArray(action.chat.messages))throw new Error('不能用会话摘要覆盖正文。');
  const merged=mergeChat(current,action.chat,action.base);
  if(merged){put({...merged,revision:(current.revision||0)+1,updated:Date.now()});savedChatId=merged.id;}
  else {const copy={...action.chat,id:crypto.randomUUID(),revision:1,conflictOf:action.chat.id,title:(action.chat.title||'新对话')+'（冲突副本）',updated:Date.now()};put(copy);savedChatId=copy.id;store.active=copy.id;conflict=true;}
 }
 if(action.op==='rename'&&store.chats.some(c=>c.id===action.id)){const c=await read(action.id);c.title=String(action.title).trim().slice(0,100)||'未命名对话';c.revision=(c.revision||0)+1;put(c);}
 if(action.op==='delete'&&store.chats.some(c=>c.id===action.id)){deleted=await read(action.id);store.chats=store.chats.filter(c=>c.id!==action.id);if(!store.chats.length)put(newChat());if(store.active===action.id)store.active=store.chats[0].id;changed=true;}
 if(action.op==='restore'&&action.chat&&!store.chats.some(c=>c.id===action.chat.id)){put(action.chat);store.active=action.chat.id;}
 // Keep the active composer, but remove abandoned blank placeholders, including old ones.
 // Unsent text, selection sources, attachments and model context are never pruned.
 const retained=store.chats.filter(c=>c.id===store.active||!isBlankChat(c));if(retained.length!==store.chats.length){store.chats=retained;changed=true;}
 if(Object.keys(writes).length)await storage.set(writes);
 if(changed)await storage.set({chatStore:store});
 const removed=previousIds.filter(id=>!store.chats.some(c=>c.id===id));if(removed.length)await storage.remove(removed.map(chatKey));
 // Compact clients load one body. Full reads remain available for export/legacy
 // callers; full-text search scans on explicit request, not on every draft save.
 let entries=store.chats;
 if(action.op==='search'&&action.query){const q=String(action.query).toLowerCase(),matches=[];for(const s of entries){const c=await read(s.id);if([c.title,...c.messages.map(m=>m.content)].join('\n').toLowerCase().includes(q))matches.push(s);}entries=matches;}
 const target=savedChatId||(action.op==='read'?action.id:store.active);
 const chats=await Promise.all(entries.map(c=>!action.compact||c.id===target&&action.op!=='list'&&action.op!=='search'?read(c.id):c));
 return {store:{...store,chats},deleted,savedChatId,conflict};
}
export function obsidianMath(text){return text.split(/(```[\s\S]*?```|`[^`\n]*`)/g).map((p,i)=>i%2?p:p.replace(/\\\(([\s\S]*?)\\\)/g,(_,m)=>'$'+m+'$').replace(/\\\[([\s\S]*?)\\\]/g,(_,m)=>'\n$$\n'+m.trim()+'\n$$\n')).join('');}
export function exportChat(c){return '# '+c.title+'\n\n'+c.messages.map(m=>'## '+(m.role==='user'?'你':'GPT')+(m.failed?'（未完成）':'')+'\n\n'+obsidianMath(m.citedContent||m.content||'')+(m.sources?.length?'\n\n联网来源：\n'+sourceMarkdown(m.sources):'')+(m.files?.length?'\n\n附件：'+m.files.map(f=>f.name).join('、'):'')).join('\n\n---\n\n')+'\n';}
export function effortsFor(m){const known=['none','minimal','low','medium','high','xhigh','max'];if(m?.efforts?.length)return m.efforts.filter(e=>known.includes(e));if(m?.id==='gpt-6.1-sol')return ['low','medium','high','xhigh','max'];return [];}
export function fileLimitMB(value){const n=Number(value);return [1,2,3,4,5].includes(n)?n:1;}
export function textFile(a,limit=1){if(typeof a?.content!=='string'||new TextEncoder().encode(a.content).length>fileLimitMB(limit)*1000000)throw new Error('文件内容超过设置的 '+fileLimitMB(limit)+' MB 上限或格式不正确。');const name=String(a.filename||'').replace(/[\\/:*?"<>|\x00-\x1f]/g,'_').slice(0,120);if(!/\.(md|txt|csv|json|html|tex|xml|yaml|yml|log)$/i.test(name))throw new Error('目前只支持文本类文件。');return {id:crypto.randomUUID(),name,content:a.content};}
export const FILE_TOOL={type:'namespace',name:'files',description:'创建本地可下载的文本文件，不执行内容。',tools:[{type:'function',name:'create_text_file',description:'创建 UTF-8 的 md、txt、csv、json、html、tex 等文件，最多 1 MB。不支持 PDF、Word 等二进制格式。',strict:true,parameters:{type:'object',properties:{filename:{type:'string'},content:{type:'string'}},required:['filename','content'],additionalProperties:false}}]};

export function fileToolFor(limit){const mb=fileLimitMB(limit),tool=structuredClone(FILE_TOOL);tool.tools[0].description=tool.tools[0].description.replace('1 MB',mb+' MB');return tool;}
