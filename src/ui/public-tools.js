import {publicUrl,cachedSource,storeSource,sourceById,readSource,findSource} from '../shared/public-sources.js';
import {readPublic} from './public-reader.js';
export const publicNames=new Set(['read_url','find_in_source','read_source']);
export function publicCall(call){const name=call.name?.replace(/^public_web\./,'');return publicNames.has(name)&&(!call.namespace||call.namespace==='public_web')?name:null;}
export async function executePublic(chat,call,{signal,onDiagnostic=()=>{},reader=readPublic}={}){
 const operation=publicCall(call),start=Date.now();let result;
 const diag={request_id:crypto.randomUUID(),call_id:call.call_id,operation,source_id:null,requested_url:null,final_url:null,http_status:null,content_type:null,extracted_chars:null,returned_chars:null,prepared_output_chars:null,submitted_output_chars:null,delivered_chars:null,delivery_state:'not_submitted',started_at:new Date(start).toISOString(),failure_stage:null,error_code:null,error_message:null,cached:false};
 onDiagnostic({...diag,status:'started'});
 try{
  if(!operation)throw new Error('Unknown or disabled public tool.');const args=JSON.parse(call.arguments);
  if(operation==='read_url'){
   if(args.refresh!==undefined&&args.refresh!==null&&typeof args.refresh!=='boolean')throw new Error('Refresh must be a boolean or null.');
   diag.requested_url=typeof args.url==='string'?args.url:null;const url=publicUrl(args.url),old=cachedSource(chat,url);
   if(old&&(!args.refresh||old.error_code||!['success','partial'].includes(old.status))){result={...readSource(old),cached:true};}
   else{const content=await reader(url,{signal});if(signal?.aborted)throw new DOMException('Stopped','AbortError');result={...readSource(storeSource(chat,content)),cached:false};}
  }else{
   if(typeof args.source_id!=='string'||args.source_id.length>150)throw new Error('Expected a short public_ source ID.');
   const source=sourceById(chat,args.source_id);if(!source){result={status:'internal_error',source_id:args.source_id,content_kind:'unknown',error_code:'source_unavailable',error_message:'This public_ snapshot is missing, cleared or evicted. Hosted search IDs are not accepted. No URL was fetched.',failure_stage:'lookup'};}
   else result={...(operation==='find_in_source'?findSource(source,args.pattern):readSource(source,args.offset??0,args.length??6000)),cached:true};
  }
 }catch(e){if(signal?.aborted){onDiagnostic({...diag,status:'stopped',failure_stage:'interrupted',error_code:'AbortError',finished_at:new Date().toISOString(),duration_ms:Date.now()-start});throw e;}
  result={status:'internal_error',content_kind:'unknown',failure_stage:operation==='read_url'?'validate':'arguments',error_code:e.name||'unknown',error_message:String(e.message).slice(0,500)};
 }
 Object.assign(diag,...['source_id','fetched_at','requested_url','final_url','http_status','content_type','status','content_kind','extracted_chars','stored_chars','truncated','failure_stage','error_code','error_message','cached','downloaded_bytes','page_count','pages_read','match_count','pattern','offset','next_offset','link_count','links_truncated'].map(key=>result[key]===undefined?{}:{[key]:result[key]}));
 diag.returned_chars=typeof result.text==='string'?result.text.length:Array.isArray(result.matches)?result.matches.reduce((n,m)=>n+m.text.length,0):null;
 diag.finished_at=new Date().toISOString();diag.duration_ms=Date.now()-start;diag.prepared_output_chars=JSON.stringify(result).length;diag.delivery_state='prepared';onDiagnostic(diag);
 return {result,diagnostic:diag};
}
