import {mergeChat} from './chat-sync.js';
import {sourceMarkdown} from './web-search.js';
export function newChat(){return {id:crypto.randomUUID(),title:'新对话',created:Date.now(),updated:Date.now(),messages:[],draft:'',source:null};}
export function isBlankChat(c){return !c.messages?.length&&!c.context?.length&&!String(c.draft||'').trim()&&!c.source&&!c.materials?.length;}
export async function chatAction(storage,action){
 const saved=await storage.get(['chatStore','chatHistory','composer','composerSource']);let store=saved.chatStore;
 if(!store){const c=newChat();c.messages=saved.chatHistory||[];c.draft=saved.composer||'';c.source=saved.composerSource||null;if(c.messages.length)c.title='之前的对话';store={version:1,active:c.id,chats:[c]};}
 let deleted,savedChatId,conflict=false;
 if(action.op==='new'){const c=store.chats.find(c=>c.id===store.active&&isBlankChat(c))||store.chats.find(isBlankChat)||newChat();if(!store.chats.some(a=>a.id===c.id))store.chats.unshift(c);store.active=c.id;}
 if(action.op==='select'&&store.chats.some(c=>c.id===action.id))store.active=action.id;
 if(action.op==='save'){
  const i=store.chats.findIndex(c=>c.id===action.chat.id),current=store.chats[i];
  const merged=mergeChat(current,action.chat,action.base);
  if(merged){store.chats[i]={...merged,revision:(current.revision||0)+1,updated:Date.now()};savedChatId=merged.id;}
  else {const copy={...action.chat,id:crypto.randomUUID(),revision:1,conflictOf:action.chat.id,title:(action.chat.title||'新对话')+'（冲突副本）',updated:Date.now()};store.chats.unshift(copy);savedChatId=copy.id;store.active=copy.id;conflict=true;}
 }

 if(action.op==='rename'){const c=store.chats.find(c=>c.id===action.id);if(c){c.title=String(action.title).trim().slice(0,100)||'未命名对话';c.revision=(c.revision||0)+1;}}
 if(action.op==='delete'){deleted=store.chats.find(c=>c.id===action.id);store.chats=store.chats.filter(c=>c.id!==action.id);if(!store.chats.length)store.chats.push(newChat());if(store.active===action.id)store.active=store.chats[0].id;}
 if(action.op==='restore'&&action.chat&&!store.chats.some(c=>c.id===action.chat.id)){store.chats.unshift(action.chat);store.active=action.chat.id;}
 // Keep the active composer, but remove abandoned blank placeholders, including old ones.
 // Unsent text, selection sources, attachments and model context are never pruned.
 store.chats=store.chats.filter(c=>c.id===store.active||!isBlankChat(c));
 await storage.set({chatStore:store});if(!saved.chatStore)await storage.remove(['chatHistory','composer','composerSource']);return {store,deleted,savedChatId,conflict};
}
export function obsidianMath(text){return text.split(/(```[\s\S]*?```|`[^`\n]*`)/g).map((p,i)=>i%2?p:p.replace(/\\\(([\s\S]*?)\\\)/g,(_,m)=>'$'+m+'$').replace(/\\\[([\s\S]*?)\\\]/g,(_,m)=>'\n$$\n'+m.trim()+'\n$$\n')).join('');}
export function exportChat(c){return '# '+c.title+'\n\n'+c.messages.map(m=>'## '+(m.role==='user'?'你':'GPT')+(m.failed?'（未完成）':'')+'\n\n'+obsidianMath(m.citedContent||m.content||'')+(m.sources?.length?'\n\n联网来源：\n'+sourceMarkdown(m.sources):'')+(m.files?.length?'\n\n附件：'+m.files.map(f=>f.name).join('、'):'')).join('\n\n---\n\n')+'\n';}
export function effortsFor(m){const known=['none','minimal','low','medium','high','xhigh','max'];if(m?.efforts?.length)return m.efforts.filter(e=>known.includes(e));if(m?.id==='gpt-6.1-sol')return ['low','medium','high','xhigh','max'];return [];}
export function fileLimitMB(value){const n=Number(value);return [1,2,3,4,5].includes(n)?n:1;}
export function textFile(a,limit=1){if(typeof a?.content!=='string'||new TextEncoder().encode(a.content).length>fileLimitMB(limit)*1000000)throw new Error('文件内容超过设置的 '+fileLimitMB(limit)+' MB 上限或格式不正确。');const name=String(a.filename||'').replace(/[\\/:*?"<>|\x00-\x1f]/g,'_').slice(0,120);if(!/\.(md|txt|csv|json|html|tex|xml|yaml|yml|log)$/i.test(name))throw new Error('目前只支持文本类文件。');return {id:crypto.randomUUID(),name,content:a.content};}
export const FILE_TOOL={type:'namespace',name:'files',description:'创建本地可下载的文本文件，不执行内容。',tools:[{type:'function',name:'create_text_file',description:'创建 UTF-8 的 md、txt、csv、json、html、tex 等文件，最多 1 MB。不支持 PDF、Word 等二进制格式。',strict:true,parameters:{type:'object',properties:{filename:{type:'string'},content:{type:'string'}},required:['filename','content'],additionalProperties:false}}]};

export function fileToolFor(limit){const mb=fileLimitMB(limit),tool=structuredClone(FILE_TOOL);tool.tools[0].description=tool.tools[0].description.replace('1 MB',mb+' MB');return tool;}
