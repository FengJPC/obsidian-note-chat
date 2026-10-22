import {Marked} from './vendor/marked.js';
import katex from './vendor/katex/katex.mjs';
export function mathToken(src,display){
 const patterns=display?[/^\\\[([\s\S]*?)\\\]/,/^\$\$([\s\S]*?)\$\$/,/^(\\begin\{(equation\*?|align\*?|aligned|gather\*?|matrix|pmatrix|bmatrix|cases)\}[\s\S]*?\\end\{\2\})/]:[/^\\\(([^\n]*?)\\\)/,/^\$(?!\$)([^\n$]+?)\$(?![\d$])/];
 for(const re of patterns){const m=re.exec(src);if(m&&m[1].trim())return {type:display?'mathBlock':'mathInline',raw:m[0],tex:m[1],display};}
}
export function mathMarkdown(text){
 const formulas=new Map(),prefix='math'+crypto.randomUUID().replaceAll('-','');let index=0;
 const parser=new Marked({breaks:true,extensions:[...['block','inline'].map(level=>({
  name:level==='block'?'mathBlock':'mathInline',level,
  start(src){const match=level==='block'?/(?:^|\n)[ \t]*(?:\\\[|\$\$|\\begin\{)/.exec(src):/\\\(|\$(?!\$)/.exec(src);return match?.index;},
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
