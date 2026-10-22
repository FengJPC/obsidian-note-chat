import test from 'node:test';import assert from 'node:assert/strict';
import {requestedMaterial,wantsFile,materialInput} from '../src/shared/materials.js';

test('ordinary conversation, questions and negations never trigger page reads',()=>{
 for(const text of ['你好','帮我解释这个公式','不要读一下当前网页','怎么读取网页','你能看一下网页吗','例如：读一下当前网页','看一下这段话','不要读当前笔记','你能读一下当前笔记吗','如果读一下当前笔记会怎样'])assert.equal(requestedMaterial(text),null,text);
 assert.equal(requestedMaterial('读一下当前笔记'),'read');assert.equal(requestedMaterial('读一下当前网页'),'read');assert.equal(requestedMaterial('请看一下'),'read');assert.equal(requestedMaterial('看一下左边这篇论文'),'read');assert.equal(requestedMaterial('请截图看看页面图表'),'screenshot');
 assert.equal(wantsFile('你好'),false);assert.equal(wantsFile('请生成研究笔记文件'),true);assert.equal(wantsFile('不要生成文件'),false);
 assert.equal(wantsFile('怎么生成文件'),false);assert.equal(wantsFile('你能生成文件吗'),false);
});
test('user-selected materials use text and image parts without converting data to instructions',()=>{
 const c=materialInput('看一下',[{name:'文档',text:'数据'},{name:'截图',image:'data:image/jpeg;base64,AA=='}]);assert.equal(c[0].text,'看一下');assert.equal(c.at(-1).type,'input_image');assert.equal(c.at(-1).image_url,'data:image/jpeg;base64,AA==');
});
