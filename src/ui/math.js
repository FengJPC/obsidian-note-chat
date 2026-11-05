import {Marked} from './vendor/marked.js';
import katex from './vendor/katex/katex.mjs';
const blockMathStart=src=>/(?:^|\n) {0,3}(?:\\\[|\$\$|\\begin\{)/.exec(src)?.index;
export function mathToken(src,display){
 const indent=display?/^ {0,3}/.exec(src)[0].length:0;
 const patterns=display?[/^\\\[([\s\S]*?)\\\]/,/^\$\$([\s\S]*?)\$\$/,/^(\\begin\{(equation\*?|align\*?|aligned|gather\*?|matrix|pmatrix|bmatrix|cases)\}[\s\S]*?\\end\{\2\})/]:[/^\\\(([^\n]*?)\\\)/,/^\$(?!\$)([^\n$]+?)\$(?![\d$])/];
 for(const re of patterns){const m=re.exec(src.slice(indent));if(m&&m[1].trim())return {type:display?'mathBlock':'mathInline',raw:src.slice(0,indent+m[0].length),tex:m[1],display};}
}
export function mathMarkdown(text){
 const formulas=new Map(),prefix='math'+crypto.randomUUID().replaceAll('-','');let index=0;
 const parser=new Marked({breaks:true,tokenizer:{
  lheading(src){
   // Marked checks Setext headings before it clips paragraphs at startBlock.
   // A standalone '=' inside a following formula must not consume its opener
   // (or preceding formulas) as a heading. Let our math block tokenize first.
   const match=this.rules.block.lheading.exec(src);
   if(match&&blockMathStart(match[1])!==undefined)return;
   return false; // Keep ordinary underlined Markdown headings.
  }
 },extensions:[...['block','inline'].map(level=>({
  name:level==='block'?'mathBlock':'mathInline',level,
  start(src){
   // Marked passes source.slice(1) here, so its start is not a line boundary.
   // Only interrupt on a real newline; otherwise `\[x\]` is split as math.
   return level==='block'?/\n {0,3}(?:\\\[|\$\$|\\begin\{)/.exec(src)?.index:/\\\(|\$(?!\$)/.exec(src)?.index;
  },
  tokenizer(src){return mathToken(src,level==='block');},
  renderer(token){const id=prefix+(index++);formulas.set(id,token);return `<span data-formula="${id}"></span>`+(token.display?'\n':'');}
 }))]});
 return {html:parser.parse(text),formulas};
}
export function renderFormula(token){
 const node=document.createElement('span');node.className=token.display?'math-display':'math-inline';
 node.title=token.tex;
 try{if(token.tex.length>20000)throw new Error('公式过长');katex.render(token.tex,node,{displayMode:token.display,throwOnError:true,trust:false,strict:'ignore',maxExpand:500,maxSize:20,macros:{}});}
 catch{node.className+=' math-error';node.textContent=token.raw;node.title='公式未能排版，保留原文';}
 return node;
}
