import test from 'node:test';
import assert from 'node:assert/strict';
import {diagnosticRecord,diagnosticAction,diagnosticExport,diagnosticUrl,MAX_RECORDS,MAX_BYTES} from '../src/shared/web-diagnostics.js';
const storage=()=>{let data={};return {get:async key=>({[key]:structuredClone(data[key])}),set:async obj=>{data={...data,...structuredClone(obj)};}};};
const recorder=()=>diagnosticRecord({model:'fixture-model',effort:'high',generationId:'generation-test',round:1});
test('Hosted search keeps aggregate query lists, missing fields and explicitly empty URLs without guessing results',()=>{
 const d=recorder();d.accept({type:'response.created',response:{id:'resp_fixture',input:'SECRET CHAT'}});
 d.accept({type:'response.output_item.added',output_index:2,item:{type:'web_search_call',id:'ws_batch',status:'in_progress',action:{type:'search',queries:['query one','query two','query three']}}});
 d.accept({type:'response.web_search_call.searching',output_index:2,item_id:'ws_batch'});
 d.accept({type:'response.output_item.done',output_index:2,item:{type:'web_search_call',id:'ws_batch',status:'completed',action:{type:'search',sources:[{url:'https://example.com/page'}]}}});
 d.accept({type:'response.output_item.done',output_index:3,item:{type:'web_search_call',id:'ws_open',status:'failed',action:{type:'open_page',url:''},error:{code:'internal_error',message:'URL  cannot be opened'}}});
 d.accept({type:'response.output_item.done',output_index:4,item:{type:'web_search_call',id:'ws_find',status:'completed',action:{type:'find_in_page',url:'https://example.com/page',pattern:'limit'}}});
 d.http({status:200,headers:new Headers({'x-request-id':'request_fixture'})});d.finish('completed');
 const r=d.snapshot();assert.equal(r.response_id,'resp_fixture');assert.equal(r.api_request_id,'request_fixture');
 assert.deepEqual(r.calls[0].queries,['query one','query two','query three']);assert.equal(r.calls[0].sources_scope,'call_aggregate_not_per_query');
 assert.equal(r.calls[1].url,'');assert.equal(r.calls[1].url_state,'empty');assert.equal(r.calls[1].status,'failed');assert.equal(r.outcome,'completed');assert.equal(r.api_http_status,200);
 assert.equal(r.calls[2].pattern,'limit');assert.equal(r.calls[2].page_content_length,null);assert.equal(r.calls[0].url_state,'missing');assert.equal(r.calls[0].page_http_status,null);
 assert.ok(!JSON.stringify(r).includes('SECRET CHAT'));
});
test('Projection and export exclude raw input, headers, text, reasoning, files, credential echoes and unsafe URLs',async()=>{
 const d=recorder();
 d.accept({type:'response.output_text.delta',delta:'PRIVATE ANSWER',response:{id:'resp_safe',reasoning:'PRIVATE REASONING'}});
 d.output([{type:'message',content:[{text:'PRIVATE ANSWER'}]},{type:'function_call',arguments:'PRIVATE FILE'},
  {type:'web_search_call',id:'ws_secret',status:'failed',action:{type:'open_page',url:'https://user:secret@example.com/path?access_token=token-sentinel&code=code-sentinel&q=topic#secret'},error:{code:'error',message:'Bearer test-fixture-token sk-proj-secret-key eyJabc.def.ghi user@example.com'}}],[]);
 d.finish('failed');const s=storage();
 await diagnosticAction(s,{op:'save',record:{...d.snapshot(),headers:{Authorization:'Bearer HEADER SECRET'},input:'PRIVATE INPUT',credential:'SECRET CREDENTIAL'}});
 const {log}=await diagnosticAction(s,{op:'load'}),json=diagnosticExport({records:[{...log.records[0],raw:'SECRET EXTRA'}]});
 for(const secret of ['PRIVATE ANSWER','PRIVATE FILE','PRIVATE INPUT','PRIVATE REASONING','HEADER SECRET','SECRET CREDENTIAL','SECRET EXTRA','token-sentinel','code-sentinel','test-fixture-token','sk-proj-secret-key','eyJabc.def.ghi','user@example.com'])assert.ok(!json.includes(secret),secret);
 assert.ok(json.includes('REDACTED'));assert.equal(diagnosticUrl('javascript:alert(1)'),null);
 const echo=recorder();echo.finish('http_error',{message:'Bad input: {"input":"full private chat"}'});assert.ok(!JSON.stringify(echo.snapshot()).includes('full private chat'));
});
test('Terminal status preserves partial tools, missing request headers and incomplete reasons; never invents page status',()=>{
 for(const outcome of ['http_error','network_error','stream_interrupted','stopped','timed_out','incomplete','failed']){
  const d=recorder();d.accept({type:'response.output_item.added',output_index:0,item:{type:'web_search_call',id:'ws_partial',status:'in_progress'}});
  d.accept({type:'response.incomplete',response:{id:'resp_partial',incomplete_details:{reason:'max_output_tokens'}}});
  d.finish(outcome);d.finish('completed');const r=d.snapshot();assert.equal(r.outcome,outcome);assert.equal(r.calls[0].status,'in_progress');assert.equal(r.calls[0].page_http_status,null);assert.equal(r.api_http_status,null);assert.equal(r.api_request_id,null);assert.equal(r.incomplete_reason,'max_output_tokens');assert.ok(r.finished_at);
 }
});
test('Records update by local request ID, cap storage, and clear independently of credentials and chats',async()=>{
 const s=storage();await s.set({credential:'UNCHANGED',chatStore:{id:'unchanged'}});
 for(let i=0;i<MAX_RECORDS+5;i++){const d=recorder();await diagnosticAction(s,{op:'save',record:d.snapshot()});d.finish('completed');await diagnosticAction(s,{op:'save',record:d.snapshot()});}
 let {log}=await diagnosticAction(s,{op:'load'});assert.equal(log.records.length,MAX_RECORDS);assert.ok(new TextEncoder().encode(JSON.stringify(log.records)).length<=MAX_BYTES);assert.ok(log.records.every(r=>r.outcome==='completed'));
 const d=recorder();for(let i=0;i<200;i++)d.accept({type:'response.web_search_call.searching',item_id:'ws',output_index:0});assert.equal(d.snapshot().events.length,150);assert.equal(d.snapshot().truncated,true);
 await diagnosticAction(s,{op:'clear'});({log}=await diagnosticAction(s,{op:'load'}));assert.equal(log.records.length,0);assert.equal((await s.get('credential')).credential,'UNCHANGED');assert.deepEqual((await s.get('chatStore')).chatStore,{id:'unchanged'});
});

test('Byte quota drops older large logs before the count limit and keeps the newest metadata',async()=>{
 const s=storage();let newest;
 for(let n=0;n<4;n++){
  const d=recorder();d.output(Array.from({length:10},(_,i)=>({type:'web_search_call',id:'ws_'+i,status:'completed',action:{type:'search',queries:['topic'],sources:Array.from({length:50},(_,j)=>({url:'https://example.com/'+('a'.repeat(1800))+j}))}})));
  d.finish('completed');newest=d.snapshot();await diagnosticAction(s,{op:'save',record:newest});
 }
 const {log}=await diagnosticAction(s,{op:'load'});assert.ok(log.records.length<4);assert.ok(log.records.length>0);
 assert.ok(new TextEncoder().encode(JSON.stringify(log)).length<=MAX_BYTES);assert.equal(log.records.at(-1).local_request_id,newest.local_request_id);
});
