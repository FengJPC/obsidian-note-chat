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
  }
 }
 return {accept,output(response){
  const result=new Map(items);
  for(const [i,item] of (response?.output||[]).entries())result.set(i,{...result.get(i),...structuredClone(item)});
  return [...result.entries()].sort(([a],[b])=>a-b).map(([,item])=>item);
 }};
}
