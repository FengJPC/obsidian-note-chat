import {hostCall} from './bridge.js';

export async function publicFetch(url, {signal} = {}) {
  const requestId = crypto.randomUUID();
  if (signal?.aborted) throw new DOMException('Stopped','AbortError');
  let rejectAbort;
  const interrupted = new Promise((_,reject)=>{rejectAbort=()=>{
    hostCall({type:'cancelPublicRead',requestId}).catch(()=>{});
    reject(new DOMException('Stopped','AbortError'));
  };});
  signal?.addEventListener('abort',rejectAbort,{once:true});
  try {
    const result = await Promise.race([hostCall({type:'publicRead',requestId,url},45000),interrupted]);
    if (!result.ok) throw new Error(result.error);
    if (signal?.aborted) throw new DOMException('Stopped','AbortError');
    const bytes = Uint8Array.from(atob(result.bodyBase64 || ''),c=>c.charCodeAt(0));
    const response = new Response([204,205,304].includes(result.status)?null:bytes,{status:result.status,headers:result.headers});
    Object.defineProperty(response,'url',{value:result.url});
    return response;
  } finally {signal?.removeEventListener('abort',rejectAbort);}
}
