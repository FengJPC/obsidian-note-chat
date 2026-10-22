import test from 'node:test';
import assert from 'node:assert/strict';
import {chatAction} from '../src/shared/chats.js';
import {chatSaver} from '../src/shared/chat-sync.js';
function fixture() {
  let data = {}, queue = Promise.resolve();
  const storage = {get: async keys => Object.fromEntries(keys.map(k => [k, structuredClone(data[k])])), set: async x => {Object.assign(data, structuredClone(x));}, remove: async () => {}};
  const run = action => {const job = queue.then(() => chatAction(storage, action)); queue = job.catch(() => {}); return job;};
  return {run, read: () => structuredClone(data.chatStore)};
}
async function windows() {
  const f = fixture(), {store} = await f.run({op:'load'});
  const a = chatSaver(f.run), b = chatSaver(f.run);
  return {...f, a, b, ca:a.adopt(structuredClone(store.chats[0])), cb:b.adopt(structuredClone(store.chats[0]))};
}
test('stale draft saves cannot erase another window messages, citations or model context', async () => {
  const {a,b,ca,cb,read} = await windows();
  ca.messages.push({role:'user',content:'q'},{role:'assistant',content:'answer',sources:[{url:'https://example.com'}]});
  ca.context=[{role:'user',content:'q'},{role:'assistant',content:'answer'}];
  await a.save(ca);
  cb.draft='unsent'; cb.materials=[{id:'pdf',text:'keep'}]; await b.save(cb);
  assert.equal(read().chats.length,1); assert.deepEqual(cb.messages,ca.messages); assert.deepEqual(cb.context,ca.context);
  assert.equal(read().chats[0].draft,'unsent'); assert.equal(read().chats[0].materials[0].text,'keep');
  // The generating window can subsequently finish without overwriting the remote draft.
  ca.messages[1].content+=' finished'; await a.save(ca);
  assert.equal(read().chats[0].draft,'unsent'); assert.equal(read().chats[0].messages[1].content,'answer finished');
});
test('concurrent answers and conflicting drafts retain both branches, including subsequent saves', async () => {
  const {a,b,ca,cb,read} = await windows();
  ca.messages.push({role:'assistant',content:'A'}); cb.messages.push({role:'assistant',content:'B'});
  const results=await Promise.all([a.save(ca),b.save(cb)]);
  assert.equal(results[1].conflict,true); assert.notEqual(ca.id,cb.id);
  cb.messages[0].content+=' complete'; await b.save(cb);
  assert.deepEqual(read().chats.map(c=>c.messages[0].content).sort(),['A','B complete']);
});
test('same-field draft conflict, rename and deleted-chat recovery do not overwrite existing work', async () => {
  const {a,b,ca,cb,read,run} = await windows();
  ca.draft='A';cb.draft='B';await a.save(ca);await b.save(cb);
  assert.deepEqual(read().chats.map(c=>c.draft).sort(),['A','B']);
  await run({op:'rename',id:ca.id,title:'Renamed'});ca.draft+=' next';await a.save(ca);
  assert.equal(ca.title,'Renamed');
  await run({op:'delete',id:ca.id});ca.draft+=' rescued';const receipt=await a.save(ca);
  assert.equal(receipt.conflict,true);assert.ok(read().chats.some(c=>c.draft==='A next rescued'));
});
test('queued saves preserve edits made while awaiting storage and keep the live answer object', async () => {
  const f=fixture(),{store}=await f.run({op:'load'});let release,started;
  const ready=new Promise(r=>started=r),gate=new Promise(r=>release=r);let first=true;
  const saver=chatSaver(async action=>{if(first){first=false;started();await gate;}return f.run(action);});
  const chat=saver.adopt(store.chats[0]),answer={role:'assistant',content:'first'};chat.messages.push(answer);
  const p=saver.save(chat);await ready;answer.content+=' second';chat.draft='late';const q=saver.save(chat);release();await Promise.all([p,q]);
  assert.equal(chat.messages[0],answer);assert.equal(f.read().chats[0].messages[0].content,'first second');assert.equal(f.read().chats[0].draft,'late');assert.ok(saver.clean(chat));
});
test('legacy stale writers without a base are isolated instead of overwriting', async () => {
  const {a,ca,cb,run,read}=await windows();ca.messages.push({role:'assistant',content:'new'});await a.save(ca);
  cb.draft='legacy';const result=await run({op:'save',chat:cb});assert.equal(result.conflict,true);assert.equal(read().chats.length,2);
});

test('legacy absent composer fields are equivalent to empty fields after sending',async()=>{
 const f=fixture(),{store}=await f.run({op:'load'}),initial=store.chats[0];delete initial.source;delete initial.materials;
 const a=chatSaver(f.run),b=chatSaver(f.run),ca=a.adopt(structuredClone(initial)),cb=b.adopt(structuredClone(initial));
 ca.messages.push({role:'assistant',content:'new answer'});ca.source=null;ca.materials=[];await a.save(ca);
 cb.draft='unsent';const result=await b.save(cb);assert.equal(result.conflict,false);assert.equal(cb.messages[0].content,'new answer');
});
