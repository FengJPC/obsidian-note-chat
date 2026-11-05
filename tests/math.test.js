import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {mathMarkdown} from '../src/ui/math.js';
import katex from '../src/ui/vendor/katex/katex.mjs';

const fixture=fs.readFileSync(new URL('./fixtures/math-response.md',import.meta.url),'utf8');
const tokens=text=>[...mathMarkdown(text).formulas.values()];

test('multiline physics formulas do not become Setext headings or swallow adjacent math',()=>{
 const {html,formulas}=mathMarkdown(fixture),all=[...formulas.values()];
 assert.equal(all.filter(t=>t.display).length,5);
 assert.equal(all.filter(t=>!t.display).length,4);
 assert.doesNotMatch(html,/<h1>/);
 assert.match(html,/<h2>公式排版回归<\/h2>/);
 for(const t of all)assert.doesNotThrow(()=>katex.renderToString(t.tex,{displayMode:t.display,throwOnError:true,trust:false,strict:'ignore'}));
 assert.match(html,/<code>\\\(x=1\\\)<\/code>/);
 assert.match(html,/<pre><code class="language-tex">\\\[\nx\n=\ny\n\\\]/);
});

test('all display delimiters protect standalone equals and minus lines, including nested Markdown',()=>{
 for(const [open,close] of [['\\[','\\]'],['$$','$$'],['\\begin{aligned}','\\end{aligned}']]){
  for(const operator of ['=','-','===','---']){
   const source=`Formula follows\n${open}\na\n${operator}\nb\n${close}`;
   for(const nested of [source,source.split('\n').map(line=>'> '+line).join('\n'),'- '+source.replaceAll('\n','\n  ')]){
    const r=mathMarkdown(nested),all=[...r.formulas.values()];
    assert.equal(all.length,1,nested);assert.equal(all[0].display,true);
    assert.ok(all[0].tex.includes(`a\n${operator}\nb`));
    assert.doesNotMatch(r.html,/<h[12]>/);
   }
  }
 }
});

test('ordinary underlined headings, fenced and indented code, and escaped math stay Markdown',()=>{
 const source='Title\n=====\n\nSubtitle\n------\n\nBefore formula\n\\[a\n=\nb\\]';
 const r=mathMarkdown(source);
 assert.match(r.html,/<h1>Title<\/h1>/);assert.match(r.html,/<h2>Subtitle<\/h2>/);
 assert.equal(r.formulas.size,1);
 for(const code of ['```tex\n\\[a\n=\nb\\]\n```','~~~tex\n$$a\n=\nb$$\n~~~','    \\[a\n    =\n    b\\]','`\\[a=b\\]`',String.raw`\\(x\\)`])assert.equal(tokens(code).length,0,code);
});

test('streaming math becomes complete on closing delimiter without mutating the stored text',()=>{
 const full=String.raw`Before
\[
\frac{a}{b}
=
c
\]`,close=full.indexOf('\\]');
 for(let end=0;end<=full.length;end++){
  const r=mathMarkdown(full.slice(0,end));
  assert.equal(r.formulas.size,end<close+2?0:1);
 }
 assert.equal(tokens(full)[0].raw,full.slice(full.indexOf('\\[')));
});
