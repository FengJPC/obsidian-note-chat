import test from 'node:test';import assert from 'node:assert/strict';
import {chatAction,exportChat,effortsFor,textFile,fileLimitMB,fileToolFor} from '../src/shared/chats.js';
function memory(initial={}){let state=structuredClone(initial);return {get:async keys=>Object.fromEntries(keys.map(k=>[k,structuredClone(state[k])])),set:async x=>{Object.assign(state,structuredClone(x));},remove:async keys=>keys.forEach(k=>delete state[k])};}
test('legacy messages and draft migrate; new chat preserves old history; delete can undo',async()=>{const s=memory({chatHistory:[{role:'user',content:'old'}],composer:'draft'});let {store}=await chatAction(s,{op:'load'});assert.equal(store.chats[0].messages[0].content,'old');assert.equal(store.chats[0].draft,'draft');const old=store.active;store=(await chatAction(s,{op:'new'})).store;assert.equal(store.chats.length,2);let r=await chatAction(s,{op:'delete',id:old});assert.equal(r.store.chats.length,1);store=(await chatAction(s,{op:'restore',chat:r.deleted})).store;assert.equal(store.active,old);assert.equal(store.chats[0].messages[0].content,'old');});
test('export keeps Markdown and converts chat math to Obsidian without changing code',()=>{const c={title:'Test',messages:[{role:'assistant',content:'**Bold** \\(n=1\\)\n\\[x^2\\]\n```tex\n\\(n=2\\)\n```'}]};const text=exportChat(c);assert.ok(text.includes('$n=1$'));assert.ok(text.includes('$$\nx^2\n$$'));assert.ok(text.includes('\\(n=2\\)'));});
test('reasoning only exposes model-confirmed efforts; binary and oversized files rejected',()=>{assert.deepEqual(effortsFor({id:'gpt-6.1-sol'}),['low','medium','high','xhigh','max']);assert.deepEqual(effortsFor({id:'unknown'}),[]);assert.deepEqual(effortsFor({id:'custom',efforts:['high','invalid']}),['high']);assert.equal(textFile({filename:'../report.md',content:'hello'}).name,'.._report.md');assert.throws(()=>textFile({filename:'report.pdf',content:'fake PDF'}));assert.throws(()=>textFile({filename:'x.txt',content:'x'.repeat(1000001)}));});
test('configurable 1-5 MB limit counts UTF8 bytes and updates model tool description',()=>{
 assert.equal(fileLimitMB('5'),5);assert.equal(fileLimitMB(100),1);
 assert.ok(fileToolFor(5).tools[0].description.includes('5 MB'));
 assert.throws(()=>textFile({filename:'x.txt',content:'汉'.repeat(400000)},1));
 assert.equal(textFile({filename:'x.txt',content:'汉'.repeat(400000)},2).content.length,400000);
 assert.equal(textFile({filename:'x.txt',content:'x'.repeat(5000000)},5).content.length,5000000);
 assert.throws(()=>textFile({filename:'x.txt',content:'x'.repeat(5000001)},5));
});


test('blank chats are reused and abandoned placeholders pruned; drafts, selections and files survive',async()=>{
 const old={id:'old',title:'Old chat',messages:[{role:'user',content:'hello'}],draft:''};
 const blank={id:'blank',title:'新对话',messages:[],draft:''};
 const drafts=[{id:'text',messages:[],draft:'unsent'},{id:'file',messages:[],draft:'',materials:[{id:'f',name:'a.txt',text:'valuable'}]},{id:'selection',messages:[],draft:'',source:{text:'selection'}},{id:'context',messages:[],draft:'',context:[{role:'user',content:'hello'}]}];
 const s=memory({chatStore:{version:1,active:'old',chats:[old,blank,...drafts]}});
 let {store}=await chatAction(s,{op:'load'});assert.ok(!store.chats.some(c=>c.id==='blank'));assert.equal(store.chats.length,5);
 store=(await chatAction(s,{op:'new'})).store;const id=store.active;
 store=(await chatAction(s,{op:'new'})).store;assert.equal(store.active,id);assert.equal(store.chats.length,6);
 store=(await chatAction(s,{op:'select',id:'old'})).store;assert.ok(!store.chats.some(c=>c.id===id));assert.equal(store.chats.length,5);
 for(const draft of drafts)assert.deepEqual(store.chats.find(c=>c.id===draft.id),draft);
});
