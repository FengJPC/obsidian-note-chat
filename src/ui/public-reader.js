import {publicUrl,TEXT_LIMIT} from '../shared/public-sources.js';
import {pdfContent} from './pdf-reader.js';
import {publicFetch} from './public-fetch.js';
const MAX_BYTES=20_000_000;
function failure(status,stage,code,message){return {status,failure_stage:stage,error_code:code,error_message:message};}
export function htmlContent(html,baseURL){
 // Parse an inert, detached document. Remove resource-bearing attributes/tags first;
 // never attach this tree, execute scripts, load page assets, or submit forms.
 const inert=html.replace(/<(script|style|iframe|object|embed|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,' ')
  .replace(/<(link|source|video|audio|input)\b[^>]*>/gi,' ')
  .replace(/\s(?:xlink:)?href(\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))/gi,' data-public-href$1')
  .replace(/\s(?:src|srcset|poster|background|data)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi,'');
 const doc=new DOMParser().parseFromString(inert,'text/html'),title=(doc.title||'').trim().slice(0,300);
 const formula=tex=>' \\('+tex.trim()+'\\) ';
 // Wikipedia provides a hidden MathML alternative AND an aria-hidden visible
 // formula image. Preserve one TeX representation before removing hidden nodes.
 for(const node of doc.querySelectorAll('.mwe-math-element')){
  const tex=node.querySelector('annotation[encoding="application/x-tex"]')?.textContent||node.querySelector('img[alt]')?.getAttribute('alt');
  if(tex?.trim())node.replaceWith(formula(tex));
 }
 for(const node of doc.querySelectorAll('math')){
  const tex=node.querySelector('annotation[encoding="application/x-tex"]')?.textContent;
  if(tex?.trim())node.replaceWith(formula(tex));
 }
 for(const node of doc.querySelectorAll('img')){
  const alt=node.getAttribute('alt')||'',math=/math|latex/i.test(node.className)||/^\{?\\displaystyle\b/.test(alt);
  node.replaceWith(math&&alt.trim()?formula(alt):'');
 }
 for(const node of doc.querySelectorAll('form,nav,header,footer,aside,[hidden],[aria-hidden="true"],[style*="display:none"],[style*="display: none"]'))node.remove();
 const root=doc.querySelector('article')||doc.querySelector('main,[role="main"]')||doc.body;
 const links=[],seen=new Set();let linkCount=0;
 for(const node of root.querySelectorAll('a[data-public-href]')){
  try{const url=publicUrl(new URL(node.getAttribute('data-public-href'),baseURL).href);if(url===publicUrl(baseURL)||seen.has(url)||url.length>2000)continue;seen.add(url);linkCount++;if(links.length<20)links.push({url,title:(node.textContent||node.getAttribute('title')||url).replace(/\s+/g,' ').trim().slice(0,120)});}catch{}
 }
 for(const br of root.querySelectorAll('br'))br.replaceWith('\n');
 for(const block of root.querySelectorAll('p,div,section,h1,h2,h3,h4,li,tr,pre'))block.append('\n');
 const text=(root.textContent||'').replace(/[ \t\r\f]+/g,' ').replace(/ *\n */g,'\n').replace(/\n{3,}/g,'\n\n').trim();
 // Conservative visible-response evidence, not an inference from a generic failure.
 const evidence=(title+'\n'+text.slice(0,2500));
 const captcha=/^(?:.*\n)?(?:.*)(?:verify you are human|unusual traffic from your computer network|our systems have detected unusual traffic|人机验证|确认您是真人)/i.test(evidence)&&text.length<10000;
 const errorPage=/^(?:Internal Server Error|Internal Error|Access Denied|Too Many Requests|Service Unavailable|Forbidden)$/i.test(title)||/^(?:Internal Error|Access Denied|Forbidden|Too Many Requests)\s*$/i.test(text);
 const shell=!!text&&text.length<300&&/enable javascript|javascript (?:is disabled|is turned off)|requires javascript|turn on javascript/i.test(text);
 const kind=captcha?'captcha':errorPage?'error_page':shell?'page_shell':text?'article':'unknown';
 return {title,text,links,link_count:linkCount,links_truncated:linkCount>links.length,content_kind:kind,extracted_chars:text.length,truncated:text.length>TEXT_LIMIT,
  ...(captcha?failure('blocked','extract','captcha','The response asks for human verification; automatic retries are paused.'):
   errorPage?failure('fetch_error','extract','error_page','The server returned an error page.'):
   shell?failure('partial','extract','page_shell','Only a page shell or JavaScript notice was extracted.'):
   !text?failure('parse_error','extract','empty_text','No readable static text was extracted.'): {status:text.length>TEXT_LIMIT?'partial':'success',failure_stage:null,error_code:null,error_message:null})};
}
export async function readPublic(value,{signal,fetcher=publicFetch,hasPermission=()=>true}={}){
 const start=Date.now(),meta={requested_url:typeof value==='string'?value:null,final_url:null,http_status:null,content_type:null,downloaded_bytes:0,extracted_chars:null,truncated:false,content_kind:'unknown',title:'',text:''};
 let stage='validate',reader,timer;const controller=new AbortController();const abort=()=>controller.abort(signal.reason);signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
 try{
  meta.requested_url=publicUrl(value);if(controller.signal.aborted)throw new DOMException('Stopped','AbortError');
  stage='permission';if(!await hasPermission())return {...meta,...failure('permission_required',stage,'site_permission','Enable enhanced public reading in Settings and grant HTTPS site access.'),duration_ms:Date.now()-start};
  stage='fetch';timer=setTimeout(()=>controller.abort(new DOMException('Public read timed out','TimeoutError')),30000);
  // Manual mode prevents following a public URL into a local/private redirect.
  // Chromium may expose a redirect as opaque: keep status/final URL unknown then.
  const response=await fetcher(meta.requested_url,{signal:controller.signal,credentials:'omit',referrerPolicy:'no-referrer',redirect:'manual',cache:'no-store'});
  if(response.type==='opaqueredirect'||response.status>=300&&response.status<400)return {...meta,http_status:response.status||null,...failure('fetch_error','redirect','redirect_not_followed','Redirect was not followed. Use a verified final public URL or hosted search.'),duration_ms:Date.now()-start};
  meta.http_status=response.status||null;meta.final_url=response.url||null;meta.content_type=response.headers.get('content-type')?.slice(0,150)||null;
  if(!response.ok)return {...meta,...failure([401,403,429].includes(response.status)?'blocked':'fetch_error','fetch','http_'+response.status,'Server returned HTTP '+response.status+'. No automatic retry.'),duration_ms:Date.now()-start};
  const pdf=/application\/pdf/i.test(meta.content_type||''),html=/(?:text\/html|application\/xhtml\+xml)/i.test(meta.content_type||''),plain=/^text\/(?:plain|markdown)(?:;|$)/i.test(meta.content_type||'');
  if(!pdf&&!html&&!plain)return {...meta,...failure('parse_error','extract','unsupported_content_type','Expected HTML, plain text or PDF; received '+(meta.content_type||'unknown content type')+'.'),duration_ms:Date.now()-start};
  stage='download';const max=pdf?MAX_BYTES:2_000_000,declared=Number(response.headers.get('content-length'));if(declared>max)throw Object.assign(new Error('Response exceeds the '+max+' byte download limit.'),{code:'size_limit'});
  reader=response.body?.getReader();if(!reader)throw new Error('Response has no readable body.');const chunks=[];
  while(true){const {done,value:chunk}=await reader.read();if(done)break;meta.downloaded_bytes+=chunk.length;if(meta.downloaded_bytes>max)throw Object.assign(new Error('Response exceeds the download limit.'),{code:'size_limit'});chunks.push(chunk);}
  const bytes=new Uint8Array(meta.downloaded_bytes);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}
  stage='extract';let content;
  if(pdf)content={...await pdfContent(bytes,{signal:controller.signal}),content_kind:'pdf',status:'success',failure_stage:null,error_code:null,error_message:null};
  else if(html)content=htmlContent(new TextDecoder().decode(bytes),meta.final_url||meta.requested_url);
  else{const text=new TextDecoder().decode(bytes).trim();content={text,content_kind:'plain_text',extracted_chars:text.length,truncated:text.length>TEXT_LIMIT,...(text?{status:'success',failure_stage:null,error_code:null,error_message:null}:failure('parse_error','extract','empty_text','The response contains no readable text.'))};}
  if(controller.signal.aborted)throw controller.signal.reason;
  if(content.truncated&&content.status==='success')content.status='partial';
  return {...meta,...content,text:content.text.slice(0,TEXT_LIMIT),duration_ms:Date.now()-start};
 }catch(e){
  if(signal?.aborted)throw new DOMException('Stopped','AbortError');
  const timedOut=controller.signal.reason?.name==='TimeoutError';
  return {...meta,...failure(timedOut?'timeout':stage==='extract'?'parse_error':'fetch_error',stage,timedOut?'read_timeout':typeof e.code==='string'?e.code:e.name||'unknown',String(e.message||'Unknown public read error').slice(0,500)),duration_ms:Date.now()-start};
 }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);if(reader){await reader.cancel().catch(()=>{});reader.releaseLock();}}
}
