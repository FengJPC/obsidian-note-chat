// Only project API-visible metadata. Never persist headers, input, text, reasoning or files.
export const DIAGNOSTIC_KEY='webDiagnostics';
export const MAX_RECORDS=50,MAX_BYTES=2_000_000;
const statuses=new Set(['started','completed','failed','incomplete','stream_interrupted','network_error','stopped','timed_out','http_error']);
const secretKey=/^(?:access[_-]?token|refresh[_-]?token|id[_-]?token|token|authorization|auth|password|passwd|secret|client_secret|api[_-]?key|key|code|state|session|session_id|credential|signature|sig)$/i;
export function redact(value,max=1000){
 if(typeof value!=='string')return null;
 const cleaned=value.replace(/Bearer\s+[^\s"'<>]+/gi,'Bearer [REDACTED]')
  .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,'[REDACTED JWT]')
  .replace(/\bsk-[A-Za-z0-9_-]+/g,'[REDACTED KEY]')
  .replace(/\b(?:access_token|refresh_token|id_token|client_secret|password|api_key|authorization)\s*[=:]\s*["']?[^\s,"';&<>]+/gi,'[REDACTED CREDENTIAL]');
 return (cleaned.includes('@')?cleaned.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,'[REDACTED EMAIL]'):cleaned).slice(0,max);
}
export function diagnosticUrl(value){
 if(value==='')return '';
 try{const u=new URL(value);if(!['https:','http:'].includes(u.protocol))return null;
  u.username='';u.password='';u.hash='';
  for(const [key,val]of [...u.searchParams])u.searchParams.set(key,secretKey.test(key)?'[REDACTED]':redact(val,500));
  return redact(u.href,2000);
 }catch{return null;}
}
const field=value=>value===undefined||value===null?'missing':value===''?'empty':'present';
const safeError=value=>({code:redact(value?.code,120),message:typeof value?.message==='string'&&/"(?:input|messages|headers|authorization|refresh_token)"\s*:/i.test(value.message)?'[omitted: possible request or credential echo]':redact(value?.message,500)});
function callProjection(item,index){
 const a=item?.action||{},queries=Array.isArray(a.queries)?a.queries:typeof a.query==='string'?[a.query]:null;
 const sources=Array.isArray(a.sources)?a.sources:null;
 return {call_id:redact(item?.id,150),output_index:Number.isInteger(index)?index:null,status:redact(item?.status,80),
  operation:redact(a.type,80),queries:queries?.slice(0,10).map(q=>redact(q,500))??null,
  query_state:queries===null?'missing':queries.length?'present':'empty',
  url:diagnosticUrl(a.url),url_state:field(a.url),pattern:redact(a.pattern,300),
  sources:sources?.slice(0,50).map(s=>({url:diagnosticUrl(s?.url)})).filter(s=>s.url)??null,
  reported_source_count:sources?.length??null,sources_scope:'call_aggregate_not_per_query',
  error:safeError(item?.error),page_http_status:null,page_content_length:null,final_url:null,
  missing_fields:['page_http_status','page_content_length','final_url','per_query_results','internal_source_reference_ids'],
  truncated:!!(queries?.length>10||sources?.length>50)};
}
function sanitizeCall(call){
 // Re-project on storage and export too: extra fields in a tampered record cannot leak.
 const projected=callProjection({id:call?.call_id,status:call?.status,error:call?.error,action:{type:call?.operation,queries:call?.queries,url:call?.url,pattern:call?.pattern,sources:call?.sources}},call?.output_index);
 projected.reported_source_count=Number.isInteger(call?.reported_source_count)?call.reported_source_count:projected.reported_source_count;
 projected.truncated=call?.truncated===true||projected.truncated;
 return projected;
}
function sanitizeLocalCall(value){
 const out={};
 for(const key of ['request_id','call_id','operation','source_id','status','content_kind','content_type','failure_stage','error_code','delivery_state','started_at','finished_at','fetched_at'])out[key]=redact(value?.[key],150);
 for(const key of ['requested_url','final_url'])out[key]=diagnosticUrl(value?.[key]);
 for(const key of ['http_status','downloaded_bytes','extracted_chars','stored_chars','returned_chars','prepared_output_chars','submitted_output_chars','duration_ms','page_count','pages_read','match_count','offset','next_offset','link_count'])out[key]=Number.isFinite(value?.[key])&&value[key]>=0?value[key]:null;
 out.error_message=safeError({message:value?.error_message}).message;
 out.pattern=redact(value?.pattern,300);
 out.cached=value?.cached===true;out.truncated=value?.truncated===true;out.links_truncated=value?.links_truncated===true;
 // Dispatch is observed locally; receipt/interpretation by the model is not exposed.
 out.delivered_chars=null;return out;
}
export function sanitizeRecord(value){
 return {local_request_id:redact(value?.local_request_id,100),generation_id:redact(value?.generation_id,100),round:Number.isInteger(value?.round)?value.round:null,
  started_at:redact(value?.started_at,40),finished_at:redact(value?.finished_at,40),model:redact(value?.model,100),effort:redact(value?.effort,50),
  outcome:statuses.has(value?.outcome)?value.outcome:'started',api_http_status:Number.isInteger(value?.api_http_status)?value.api_http_status:null,
  api_request_id:redact(value?.api_request_id,150),response_id:redact(value?.response_id,150),
  error:safeError(value?.error),incomplete_reason:redact(value?.incomplete_reason,120),
  calls:(Array.isArray(value?.calls)?value.calls:[]).slice(0,30).map(sanitizeCall),
  local_calls:(Array.isArray(value?.local_calls)?value.local_calls:[]).slice(0,30).map(sanitizeLocalCall),
  events:(Array.isArray(value?.events)?value.events:[]).slice(0,150).map(e=>({type:redact(e?.type,100),elapsed_ms:Number.isFinite(e?.elapsed_ms)?Math.max(0,e.elapsed_ms):null,output_index:Number.isInteger(e?.output_index)?e.output_index:null,item_id:redact(e?.item_id,150)})),
  displayed_sources:(Array.isArray(value?.displayed_sources)?value.displayed_sources:[]).slice(0,100).map(s=>({display_number:Number.isInteger(s?.display_number)?s.display_number:null,url:diagnosticUrl(s?.url)})).filter(s=>s.url),
  truncated:value?.truncated===true};
}
export function diagnosticRecord({model,effort,generationId,round,now=Date.now}){
 const start=now(),record={local_request_id:crypto.randomUUID(),generation_id:generationId,round,started_at:new Date(start).toISOString(),finished_at:null,model,effort,outcome:'started',calls:[],local_calls:[],events:[],displayed_sources:[]};
 let terminal=false;
 const updateCall=(item,index)=>{
  if(item?.type!=='web_search_call')return;
  const old=record.calls.find(c=>item.id?c.call_id===item.id:c.output_index===index);
  const projected=callProjection(item,index);
  if(old){Object.assign(old,projected,{output_index:old.output_index??projected.output_index,status:projected.status??old.status,error:item.error?projected.error:old.error,operation:projected.operation??old.operation,queries:projected.queries??old.queries,query_state:projected.query_state==='missing'?old.query_state:projected.query_state,url:projected.url_state==='missing'?old.url:projected.url,url_state:projected.url_state==='missing'?old.url_state:projected.url_state,pattern:projected.pattern??old.pattern,sources:projected.sources??old.sources,reported_source_count:projected.reported_source_count??old.reported_source_count});}
  else if(record.calls.length<30)record.calls.push(projected);else record.truncated=true;
 };
 return {
  get terminal(){return terminal;},
  snapshot:()=>sanitizeRecord(record),
  http(response){record.api_http_status=response.status;record.api_request_id=response.headers?.get('x-request-id')||null;},
  accept(event){
   if(event?.response?.id)record.response_id=event.response.id;
   if(event?.response?.error||event?.type==='error')record.error=safeError(event.response?.error||event);
   if(event?.response?.incomplete_details)record.incomplete_reason=event.response.incomplete_details.reason;
   updateCall(event?.item,event?.output_index);
   if(/^response\.web_search_call\./.test(event?.type||'')){
    const call=record.calls.find(c=>event.item_id?c.call_id===event.item_id:c.output_index===event.output_index);
    if(call)call.status=event.type.split('.').at(-1);
   }
   if(/^response\.(created|completed|failed|incomplete|web_search_call\.)/.test(event?.type||'')||event?.type==='error'||event?.item?.type==='web_search_call'){
    if(record.events.length<150)record.events.push({type:event.type,elapsed_ms:now()-start,output_index:event.output_index,item_id:event.item_id||event.item?.id});else record.truncated=true;
   }
  },
  output(items,sources=[]){items.forEach((item,i)=>updateCall(item,i));record.displayed_sources=sources.map((s,i)=>({display_number:i+1,url:s.url}));if(sources.length>100)record.truncated=true;},
  local(value){const item=sanitizeLocalCall(value),old=record.local_calls.find(c=>c.request_id===item.request_id);if(old)Object.assign(old,item);else if(record.local_calls.length<30)record.local_calls.push(item);else record.truncated=true;},
  finish(outcome,error){if(terminal)return;terminal=true;record.outcome=outcome;record.finished_at=new Date(now()).toISOString();if(error)record.error=safeError(error);}
 };
}
export async function diagnosticAction(storage,action){
 const saved=(await storage.get(DIAGNOSTIC_KEY))[DIAGNOSTIC_KEY];
 let records=(Array.isArray(saved?.records)?saved.records:[]).map(sanitizeRecord).filter(r=>r.local_request_id);
 if(action.op==='clear')records=[];
 else if(action.op==='save'){
  const record=sanitizeRecord(action.record);if(!record.local_request_id)throw new Error('Invalid diagnostic record');
  const index=records.findIndex(r=>r.local_request_id===record.local_request_id);
  if(index>=0)records[index]=record;else records.push(record);
 }else if(action.op!=='load')throw new Error('Unknown diagnostic action');
 records=records.slice(-MAX_RECORDS);
 while(records.length&&new TextEncoder().encode(JSON.stringify({schema_version:1,records})).length>MAX_BYTES)records.shift();
 const log={schema_version:1,records};
 if(action.op!=='load')await storage.set({[DIAGNOSTIC_KEY]:log});
 return {log};
}
export function diagnosticExport(log){
 return JSON.stringify({schema_version:1,exported_at:new Date().toISOString(),limits:{max_requests:MAX_RECORDS,max_bytes:MAX_BYTES},
  notes:['Hosted calls contain only API-visible metadata. local_calls contain observations from the optional anonymous public reader. Null means unknown; empty URL means explicitly empty.','Request HTTP status is not a webpage HTTP status. Completed tool status does not prove readable content.','Hosted sources belong to the whole call; query-to-result mappings and internal reference IDs are not exposed. public_ IDs refer to immutable conversation-local snapshots, not hosted IDs.','extracted_chars counts extracted text before storage clipping (PDF: processed pages only). returned_chars counts returned text/snippets. prepared_output_chars counts serialized tool JSON. submitted_output_chars means dispatched in a follow-up API request, not proven model receipt; delivered_chars stays null.','Started records have no observed terminal event; they may have been interrupted or still in flight.','Search terms, URL paths and ordinary query parameters may contain private information; review before sharing. Credentials are redacted, but automatic redaction is not a guarantee.'],
  records:(log?.records||[]).slice(-MAX_RECORDS).map(sanitizeRecord)},null,2)+'\n';
}
