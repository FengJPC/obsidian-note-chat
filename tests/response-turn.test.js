import test from 'node:test';
import assert from 'node:assert/strict';
import {responseTurn} from '../src/shared/response-turn.js';
test('tool calls and encrypted reasoning survive an empty completed response',()=>{
 const turn=responseTurn();
 const reasoning={type:'reasoning',id:'rs_1',summary:[],encrypted_content:'opaque-fixture'};
 turn.accept({type:'response.output_item.done',output_index:0,item:reasoning});
 turn.accept({type:'response.output_item.added',output_index:1,item:{type:'function_call',id:'fc_1',call_id:'call_1',name:'create_text_file',namespace:'files',arguments:''}});
 turn.accept({type:'response.function_call_arguments.delta',output_index:1,delta:'{"filename":"a.md",'});
 turn.accept({type:'response.function_call_arguments.done',output_index:1,arguments:'{"filename":"a.md","content":"你好"}'});
 const output=turn.output({output:[]});assert.deepEqual(output[0],reasoning);assert.equal(output[1].call_id,'call_1');assert.equal(JSON.parse(output[1].arguments).content,'你好');
});
test('final output replaces streamed items without duplicates or losing message phase',()=>{
 const turn=responseTurn();const call={type:'function_call',call_id:'a',arguments:'{}'};
 turn.accept({type:'response.output_item.done',output_index:0,item:call});
 assert.equal(turn.output({output:[call]}).length,1);
 const msg={type:'message',phase:'final_answer',role:'assistant',content:[{type:'output_text',text:'完成'}]};
 const other=responseTurn();other.accept({type:'response.output_item.done',output_index:0,item:msg});assert.deepEqual(other.output({}),[msg]);
});
