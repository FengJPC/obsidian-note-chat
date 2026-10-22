import test from 'node:test';
import assert from 'node:assert/strict';
import {chatAction,chatKey} from '../src/shared/chats.js';
import {chatSaver} from '../src/shared/chat-sync.js';
function fixture(initial={}){const state=structuredClone(initial),reads=[],writes=[];const storage={get:async keys=>{reads.push(...keys);return Object.fromEntries(keys.map(k=>[k,structuredClone(state[k])]));},set:async v=>{writes.push(structuredClone(v));Object.assign(state,structuredClone(v));},remove:async keys=>{for(const k of keys)delete state[k];}};return {state,storage,reads,writes,run:a=>chatAction(storage,{...a,compact:true})};}
const old=()=>({version:1,active:'a',chats:[{id:'a',title:'A',revision:5,messages:[{role:'user',content:'old',inputContent:[{type:'input_image',image_url:'data:image/png;base64,fixture'}]},{role:'assistant',content:'answer',sources:[{url:'https://example.com'}],files:[{name:'a.txt',content:'file'}]}],draft:'unsent',source:{text:'selected'},materials:[{text:'draft PDF'}],context:[{role:'assistant',content:'context'}],publicSources:[{text:'snapshot'}]},{id:'b',title:'B',messages:[{role:'user',content:'needle only in history'}]}]});
test('v1 migration preserves all message, attachment, draft, citation and context fields with a complete backup',async()=>{
 const legacy=old(),f=fixture({chatStore:legacy});const r=await f.run({op:'load'});
 assert.deepEqual(r.store.chats[0],legacy.chats[0]);assert.deepEqual(f.state[chatKey('b')],legacy.chats[1]);assert.deepEqual(f.state.chatLegacyBackup.chatStore,legacy);assert.equal(f.state.chatStore.version,2);assert.ok(r.store.chats[1].summary);
 f.writes.length=0;await f.run({op:'load'});await f.run({op:'list'});assert.equal(f.writes.length,0);
 const search=await f.run({op:'search',query:'needle'});assert.deepEqual(search.store.chats.map(c=>c.id),['b']);assert.ok(search.store.chats[0].summary);
 assert.deepEqual((await f.run({op:'read',id:'b'})).store.chats.find(c=>c.id==='b'),legacy.chats[1]);
});
test('interrupted migration keeps legacy data and retries without loss',async()=>{
 const legacy=old(),f=fixture({chatStore:legacy});const set=f.storage.set;let fail=true;
 f.storage.set=async values=>{if(values.chatStore?.version===2&&fail)throw new Error('simulated disk failure');return set(values);};
 await assert.rejects(f.run({op:'load'}),/disk failure/);assert.deepEqual(f.state.chatStore,legacy);assert.deepEqual(f.state.chatLegacyBackup.chatStore,legacy);
 fail=false;await f.run({op:'load'});assert.deepEqual(f.state[chatKey('a')],legacy.chats[0]);
});
test('compact draft saves read/write only the edited conversation, not 100 large histories',async()=>{
 const legacy=old();legacy.chats.push(...Array.from({length:100},(_,i)=>({id:'large-'+i,title:'Large',messages:[{role:'assistant',content:'x'.repeat(100000)}]})));
 const f=fixture({chatStore:legacy}),r=await f.run({op:'load'}),saver=chatSaver(f.run),c=saver.adopt(r.store.chats[0]);
 f.reads.length=0;f.writes.length=0;c.draft+='!';const saved=await saver.save(c);
 assert.deepEqual(f.reads,['chatStore','chat:a']);assert.deepEqual(f.writes.map(v=>Object.keys(v)),[['chat:a'],['chatStore']]);
 assert.ok(JSON.stringify(f.writes).length<30000);assert.ok(JSON.stringify(saved).length<30000);
});
test('compact receipts preserve concurrent edits, conflict branches and deletion undo',async()=>{
 const f=fixture({chatStore:old()}),r=await f.run({op:'load'}),a=chatSaver(f.run),b=chatSaver(f.run),ca=a.adopt(structuredClone(r.store.chats[0])),cb=b.adopt(structuredClone(ca));
 ca.messages[1].content+=' new';await a.save(ca);cb.draft+=' remote';await b.save(cb);assert.equal(cb.messages[1].content,ca.messages[1].content);
 a.adopt(Object.assign(ca,structuredClone(cb)));ca.draft='conflict A';cb.draft='conflict B';await a.save(ca);assert.equal((await b.save(cb)).conflict,true);assert.notEqual(cb.id,ca.id);
 const deleted=await f.run({op:'delete',id:ca.id});assert.equal(f.state[chatKey(ca.id)],undefined);await f.run({op:'restore',chat:deleted.deleted});assert.deepEqual(f.state[chatKey(ca.id)],deleted.deleted);
});
test('missing body and summary-only writes fail without replacing existing history',async()=>{
 const f=fixture({chatStore:old()});await f.run({op:'load'});const before=structuredClone(f.state.chatStore);delete f.state['chat:a'];
 await assert.rejects(f.run({op:'load'}),/缺失/);assert.deepEqual(f.state.chatStore,before);
 await assert.rejects(f.run({op:'save',chat:before.chats[1]}),/摘要/);assert.deepEqual(f.state['chat:b'],old().chats[1]);
});

test('storage key reordering does not fail migration or produce false conflicts',async()=>{
 const f=fixture({chatStore:old()}),get=f.storage.get;f.storage.get=async keys=>JSON.parse(JSON.stringify(await get(keys),(_k,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v));
 const r=await f.run({op:'load'}),a=chatSaver(f.run),b=chatSaver(f.run),ca=a.adopt(structuredClone(r.store.chats[0])),cb=b.adopt(structuredClone(ca));ca.messages[1].content+=' stream';await a.save(ca);cb.draft+=' draft';assert.equal((await b.save(cb)).conflict,false);assert.equal(cb.messages[1].content,ca.messages[1].content);
});
