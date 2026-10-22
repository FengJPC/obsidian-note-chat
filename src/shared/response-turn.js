// Some streaming gateways omit output from the terminal response. Preserve
// completed output items (including reasoning) instead of relying on that copy.
export function responseTurn(){
 const items=new Map();
 function accept(e){
  const index=e.output_index;
  if(!Number.isInteger(index))return;
  if(e.type==='response.output_item.added'||e.type==='response.output_item.done'){
   if(e.item)items.set(index,{...items.get(index),...structuredClone(e.item)});
  }else if(e.type==='response.function_call_arguments.delta'){
   const item=items.get(index);if(item)item.arguments=(item.arguments||'')+(e.delta||'');
  }else if(e.type==='response.function_call_arguments.done'){
   const item=items.get(index);if(item&&typeof e.arguments==='string')item.arguments=e.arguments;
  }else if(['response.content_part.added','response.content_part.done','response.output_text.delta','response.output_text.done','response.output_text.annotation.added'].includes(e.type)){
   const item=items.get(index);if(item?.type!=='message')return;
   const ci=e.content_index??0;if(!Number.isInteger(ci)||ci<0)return;
   item.content||=[];
   if(e.part){item.content[ci]=structuredClone(e.part);return;}
   const part=item.content[ci]||={type:'output_text',text:'',annotations:[]};
   if(e.type==='response.output_text.delta')part.text=(part.text||'')+(e.delta||'');
   if(e.type==='response.output_text.done'&&typeof e.text==='string')part.text=e.text;
   if(e.type==='response.output_text.annotation.added'&&e.annotation){part.annotations||=[];const ai=e.annotation_index??part.annotations.length;if(Number.isInteger(ai)&&ai>=0)part.annotations[ai]=structuredClone(e.annotation);}
  }
 }
 return {accept,output(response){
  const result=new Map(items);
  for(const [i,item] of (response?.output||[]).entries())result.set(i,{...result.get(i),...structuredClone(item)});
  return [...result.entries()].sort(([a],[b])=>a-b).map(([,item])=>item);
 }};
}
