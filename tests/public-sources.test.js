import test from 'node:test';
import assert from 'node:assert/strict';
import {publicUrl,storeSource,sourceById,cachedSource,readSource,findSource,PUBLIC_TOOL} from '../src/shared/public-sources.js';
import {searchOptions} from '../src/shared/web-search.js';
import {diagnosticRecord,diagnosticExport} from '../src/shared/web-diagnostics.js';
const value=(url='https://example.com/article',text='First line\nSome output token limit details\nLast line')=>({requested_url:url,final_url:url,http_status:200,content_type:'text/html',status:'success',content_kind:'article',text,extracted_chars:text.length,truncated:false});
test('Public URL validation rejects credentials, private/literal addresses, non-HTTPS and alternate ports before fetch',()=>{
 for(const url of ['http://example.com/','file:///C:/secret','https://localhost/','https://localhost./','https://a.local/','https://a.local./','https://a.internal/','https://127.1/','https://2130706433/','https://0x7f000001/','https://[::1]/','https://[::ffff:127.0.0.1]/','https://example.com:8443/','https://user:password@example.com/','https://example.com/?access_token=secret','https://example.com/?accessToken=secret','https://example.com/?api_key=secret'])assert.throws(()=>publicUrl(url),undefined,url);
 assert.equal(publicUrl('https://EXAMPLE.com/article?q=physics#section'),'https://example.com/article?q=physics');
});
test('Snapshots keep distinct retrieval IDs, reuse the latest URL snapshot and remain conversation-local',()=>{
 const a={},b={};const first=storeSource(a,value()),second=storeSource(a,value(undefined,'Changed article'));
 assert.notEqual(first.source_id,second.source_id);assert.equal(sourceById(a,first.source_id).text,value().text);
 assert.equal(cachedSource(a,first.requested_url),second);assert.equal(sourceById(b,first.source_id),undefined);
 for(let i=0;i<9;i++)storeSource(a,value('https://example.com/'+i,'x'.repeat(120000)));
 assert.ok(a.publicSources.length<=8);assert.ok(a.publicSources.reduce((n,s)=>n+s.text.length,0)<=480000);assert.equal(sourceById(a,first.source_id),undefined);
});
test('Find gives literal match counts, exact offsets/lines and bounded contexts including no match and truncated scope',()=>{
 const chat={},source=storeSource(chat,value(undefined,'head\n'+('TARGET [x] '+'z'.repeat(500)+'\n').repeat(12)));
 const found=findSource(source,'target [x]');assert.equal(found.match_count,12);assert.equal(found.matches.length,8);assert.equal(found.matches[0].position,5);assert.equal(found.matches[0].line,2);assert.equal(found.matches_truncated,true);assert.ok(found.matches.every(m=>m.text.length<=331));
 assert.equal(findSource(source,'NOT PRESENT').status,'no_results');assert.equal(findSource(source,'NOT PRESENT').match_count,0);
 assert.throws(()=>findSource(source,''));assert.throws(()=>findSource(source,'a'.repeat(201)));
 const partial={...source,truncated:true,status:'partial'};assert.equal(findSource(partial,'TARGET').search_scope,'stored_partial_snapshot');
 assert.equal(findSource({...source,status:'blocked',text:''},'target').status,'blocked');
});
test('Chunk reads are bounded and preserve continuation/truncation without exposing the entire snapshot',()=>{
 const source=storeSource({},value(undefined,'a'.repeat(15000)));
 const first=readSource(source,0,999999);assert.equal(first.returned_chars,12000);assert.equal(first.next_offset,12000);assert.equal(first.chunk_truncated,true);
 const last=readSource(source,first.next_offset);assert.equal(last.text.length,3000);assert.equal(last.next_offset,null);
 assert.throws(()=>readSource(source,-1));assert.throws(()=>readSource(source,0,0));assert.equal(readSource(source,20000).returned_chars,0);
});
test('Public tools require web enablement independently of file tool access',()=>{
 assert.equal(searchOptions(false,null,PUBLIC_TOOL).tools.length,0);
 assert.deepEqual(searchOptions(true,null,PUBLIC_TOOL).tools.map(t=>t.type),['web_search','namespace']);
 assert.equal(PUBLIC_TOOL.tools.length,3);for(const tool of PUBLIC_TOOL.tools)assert.equal(tool.strict,true);
});
test('Local diagnostics preserve actual page metadata but never invent delivery, expose bodies, or leak credentials',()=>{
 const d=diagnosticRecord({model:'fixture',generationId:'g',round:1});d.finish('completed');
 d.local({request_id:'reader-1',operation:'read_url',status:'blocked',http_status:429,requested_url:'https://example.com/?token=URL_SECRET',source_id:'public_fixture',extracted_chars:null,returned_chars:0,prepared_output_chars:400,delivery_state:'prepared',error_message:'Bearer TOKEN_SECRET',link_count:58,links_truncated:true,links:[{url:'https://example.com/LINK_LIST_MUST_BE_OMITTED'}],text:'BODY_SECRET',headers:{cookie:'COOKIE_SECRET'},delivered_chars:777});
 d.local({...d.snapshot().local_calls[0],submitted_output_chars:400,delivery_state:'request_dispatched'});
 const log=JSON.parse(diagnosticExport({records:[d.snapshot()]})),entry=log.records[0].local_calls[0];
 assert.equal(entry.link_count,58);assert.equal(entry.links_truncated,true);assert.ok(!JSON.stringify(log).includes('LINK_LIST_MUST_BE_OMITTED'));assert.equal(entry.http_status,429);assert.equal(entry.extracted_chars,null);assert.equal(entry.returned_chars,0);assert.equal(entry.submitted_output_chars,400);assert.equal(entry.delivered_chars,null);assert.equal(log.records[0].outcome,'completed');
 for(const secret of ['URL_SECRET','TOKEN_SECRET','BODY_SECRET','COOKIE_SECRET'])assert.ok(!JSON.stringify(log).includes(secret));
});
