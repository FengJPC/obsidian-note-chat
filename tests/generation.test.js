import test from 'node:test';
import assert from 'node:assert/strict';
import {generationWatch,recoverInterrupted} from '../src/shared/generation.js';
test('silent requests abort, active requests still have an overall limit',async()=>{
 for(const active of [false,true]){
  const c=new AbortController(),w=generationWatch(c,{idleMs:30,totalMs:90});
  const heartbeat=active?setInterval(()=>w.progress(),10):null;
  await new Promise(resolve=>c.signal.addEventListener('abort',resolve,{once:true}));
  clearInterval(heartbeat);assert.match(w.timeout,active?/15 分钟/:/3 分钟/);w.close();
 }
});
test('reopening recovers unfinished messages, preserves partial text and completed files',()=>{
 const c={messages:[{role:'user',content:'问'},{role:'assistant',content:'部分回答',pending:true},{role:'assistant',content:''},{role:'assistant',content:'',files:[{name:'a.md'}]}]};
 assert.equal(recoverInterrupted(c),true);assert.equal(c.messages[0].failed,true);assert.equal(c.messages[1].content,'部分回答');assert.equal(c.messages[1].pending,false);assert.match(c.messages[2].content,/已中断/);assert.equal(c.messages[3].failed,undefined);assert.equal(recoverInterrupted(c),false);
});

test('opening another window does not recover a live generation; expired requests still recover',()=>{const c={messages:[{role:'assistant',pending:true,content:'partial',startedAt:Date.now()}]};assert.equal(recoverInterrupted(c),false);c.messages[0].startedAt=Date.now()-920000;assert.equal(recoverInterrupted(c),true);assert.equal(c.messages[0].content,'partial');});
