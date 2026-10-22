import test from 'node:test';import assert from 'node:assert/strict';
import {budgetContext} from '../src/shared/context-budget.js';
test('budget discards whole older turns while preserving tool calls, outputs and encrypted reasoning',()=>{
 const old=[{role:'user',content:'old'.repeat(100)},{type:'function_call',call_id:'old',arguments:'{}'},{type:'function_call_output',call_id:'old',output:'old'}];
 const recent=[{role:'user',content:'recent'},{type:'reasoning',encrypted_content:'encrypted'},{type:'function_call',call_id:'live',arguments:'{}'},{type:'function_call_output',call_id:'live',output:'body'}];
 const input=[...old,...recent],snapshot=structuredClone(input),r=budgetContext(input,150);
 assert.equal(r.removed,1);assert.deepEqual(r.input,recent);assert.deepEqual(input,snapshot);
});
test('current oversized turn is rejected intact, UTF8 is counted and image base64 is not mistaken for tokens',()=>{
 assert.throws(()=>budgetContext([{role:'user',content:'汉'.repeat(100)}],250),/预算/);
 assert.equal(budgetContext([{role:'user',content:[{type:'input_image',image_url:'data:image/png;base64,'+'x'.repeat(1000000)}]}],5000).removed,0);
 const input=[{role:'user',content:'a'},{role:'assistant',content:'b'}];assert.deepEqual(budgetContext(input).input,input);
});

test('serialized image bytes also have a bound, without splitting the current turn',()=>{
 const image={role:'user',content:[{type:'input_image',image_url:'data:image/png;base64,'+'x'.repeat(1000)}]};
 assert.equal(budgetContext([image,image],10000,1500).removed,1);
 assert.throws(()=>budgetContext([image],10000,500),/预算/);
});
