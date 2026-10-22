import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {ChatStorage} from '../src/chat-storage.js';
import {chatAction} from '../src/shared/chats.js';
test('disk chat storage survives restart, keeps backup, and never rewrites unrelated bodies/settings',async()=>{
 const parent=fileURLToPath(new URL('../artifacts/',import.meta.url));await fs.mkdir(parent,{recursive:true});
 const dir=await fs.mkdtemp(path.join(parent,'note-chat-storage-'));
 try{
  const legacy={version:1,active:'a',chats:[{id:'a',title:'A',messages:[{role:'user',content:'keep'}]},{id:'../outside',title:'B',messages:[{role:'user',content:'also keep'}]}]};
  const data={chatStore:structuredClone(legacy),uiPrefs:{fontSize:18}};let settingsWrites=0;const changed=[];
  const fallback={get:async keys=>Object.fromEntries(keys.map(k=>[k,data[k]])),set:async v=>{settingsWrites++;Object.assign(data,v);},remove:async keys=>{for(const k of keys)delete data[k];}};
  const store=new ChatStorage(dir,fallback,c=>changed.push(c),async()=>{delete data.chatStore;});
  const r=await chatAction(store,{op:'load',compact:true});assert.equal(data.chatStore,undefined);assert.deepEqual((await store.get(['chatLegacyBackup'])).chatLegacyBackup.chatStore,legacy);
  const other=store.file('chat:../outside'),before=await fs.stat(other);const base=structuredClone(r.store.chats[0]),chat={...base,draft:'new draft'};
  await chatAction(store,{op:'save',chat,base,compact:true});assert.equal((await fs.stat(other)).mtimeMs,before.mtimeMs);assert.equal(settingsWrites,0);assert.deepEqual(data.uiPrefs,{fontSize:18});
  const reopened=new ChatStorage(dir,fallback);assert.equal((await chatAction(reopened,{op:'load',compact:true})).store.chats[0].draft,'new draft');assert.ok((await fs.readdir(dir)).every(f=>!f.endsWith('.tmp')));
  await fs.writeFile(store.file('chat:a'),'{broken');await assert.rejects(chatAction(reopened,{op:'load'}));
 }finally{assert.ok(path.resolve(dir).startsWith(path.resolve(parent)+path.sep));await fs.rm(dir,{recursive:true,force:true});}
});
