import test from 'node:test';
import assert from 'node:assert/strict';
import {searchOptions,searchOutput,searchStatus,searchFailure,sourceMarkdown} from '../src/shared/web-search.js';
import {responseTurn} from '../src/shared/response-turn.js';
import {exportChat,FILE_TOOL} from '../src/shared/chats.js';
import {MATERIAL_POLICY} from '../src/shared/materials.js';

test('web toggle alone grants hosted search; file tool and local material permissions remain separate',()=>{
 assert.deepEqual(searchOptions(false).tools,[]);
 assert.deepEqual(searchOptions('true').tools,[]);
 assert.equal(searchOptions(false,FILE_TOOL).tools.length,1);
 const on=searchOptions(true,FILE_TOOL);
 assert.equal(on.tools.length,2);assert.equal(on.tools[1].type,'web_search');assert.equal(on.tools[1].external_web_access,true);
 assert.ok(on.include.includes('web_search_call.action.sources'));
 assert.ok(on.instructions.includes('不必每次搜索'));assert.ok(on.instructions.includes('不代表允许读取本地笔记'));
 for(const operation of ['search','open_page','find_in_page'])assert.ok(on.instructions.includes(operation));
 assert.ok(on.instructions.includes('无需再次询问'));assert.ok(on.instructions.includes('不能把未核实的细节当作已核实'));
 assert.ok(MATERIAL_POLICY.includes('不约束已开启的公共互联网搜索工具'));
 assert.equal(searchOptions(false).include.includes('web_search_call.action.sources'),false);
});
test('streamed text and citation annotations survive an empty terminal output and Unicode offsets',()=>{
 const turn=responseTurn(),text='😀 新消息。\uE200cite\uE202turn0search0\uE201';
 const start=Array.from('😀 新消息。').length,end=Array.from(text).length;
 turn.accept({type:'response.output_item.added',output_index:0,item:{type:'message',role:'assistant',content:[]}});
 turn.accept({type:'response.output_text.delta',output_index:0,content_index:0,delta:text});
 turn.accept({type:'response.output_text.annotation.added',output_index:0,content_index:0,annotation_index:0,annotation:{type:'url_citation',start_index:start,end_index:end,url:'https://example.com/latest',title:'最新来源'}});
 const result=searchOutput(turn.output({output:[]}));
 assert.equal(result.text,text);assert.ok(result.markdown.startsWith('😀 新消息。'));
 assert.ok(result.markdown.includes('[1](<https://example.com/latest>)'));assert.equal(result.markdown.includes('\uE200'),false);
 assert.equal(result.sources[0].title,'最新来源');
});
test('search sources deduplicate, reject executable or credential URLs and export clickable MD',()=>{
 const text='事实。\uE200cite\uE202turn0search0\uE201',source={url:'https://example.com/a_(b)',title:'[Title]<script>'};
 const result=searchOutput([{type:'web_search_call',action:{sources:[source,source,{url:'javascript:alert(1)'},{url:'https://u:secret@example.com'}]}},
 {type:'message',content:[{type:'output_text',text,annotations:[{type:'url_citation',start_index:3,end_index:text.length,...source}]}]}]);
 assert.equal(result.sources.length,1);assert.equal(result.searched,true);
 assert.ok(result.markdown.includes('[1](<https://example.com/a_(b)>)'));
 const exported=exportChat({title:'测试',messages:[{role:'assistant',content:text,citedContent:result.markdown,sources:result.sources}]});
 assert.ok(exported.includes('联网来源'));assert.ok(exported.includes('https://example.com/a_(b)'));assert.equal(exported.includes('\uE200'),false);
 assert.equal(sourceMarkdown(result.sources).includes('<script>'),false);
});
test('bad citation ranges preserve answer and still offer safe source links',()=>{
 const result=searchOutput([{type:'message',content:[{type:'output_text',text:'保留原来的陈述',annotations:[{type:'url_citation',start_index:999,end_index:1000,url:'https://example.com'}]}]}]);
 assert.equal(result.markdown,'保留原来的陈述');assert.equal(result.sources.length,1);
});
test('unsupported search has an actionable manual retry notice, other failures stay intact',()=>{
 assert.ok(searchFailure(new Error('web_search is not supported for this model'),true).includes('不会自动重试'));
 assert.equal(searchFailure(new Error('HTTP 429 capacity'),true),'HTTP 429 capacity');
 assert.equal(searchFailure(new Error('web_search unsupported'),false),'web_search unsupported');
 assert.equal(searchStatus({type:'response.web_search_call.searching'}),'正在联网搜索…');
 assert.equal(searchStatus({type:'response.output_text.delta'}),'');
});
