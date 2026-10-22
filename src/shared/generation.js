export function generationWatch(controller,{idleMs=180000,totalMs=900000,onTick=()=>{}}={}) {
 const started=Date.now();let last=started,phase='正在连接',timeout='';
 const timer=setInterval(()=>{
  const now=Date.now();
  if(now-started>=totalMs||now-last>=idleMs){timeout=now-started>=totalMs?'生成超过 15 分钟，已停止。':'连接连续 3 分钟没有新进展，已停止。';controller.abort();}
  else onTick(`${phase} · ${Math.floor((now-started)/1000)} 秒`);
 },Math.min(1000,idleMs,totalMs));
 return {progress(next){last=Date.now();if(next)phase=next;},get timeout(){return timeout;},close(){clearInterval(timer);}};
}
export function recoverInterrupted(chat,{alive}={}){
 let changed=false;
 for(let i=0;i<chat.messages.length;i++){
  const m=chat.messages[i];
  // A recently started request may still belong to another window (15-minute watchdog).
  if(m.pending&&m.generationId){if(alive?alive.has(m.generationId):Date.now()-(m.heartbeatAt||m.startedAt)<120000)continue;}
  else if(m.pending&&Number.isFinite(m.startedAt)&&Date.now()-m.startedAt<910000)continue;
  if(m.role==='assistant'&&(m.pending||!m.content&&!m.failed&&!m.files?.length)){
   m.pending=false;m.failed=true;m.content ||= '上次生成已中断。可以重新发送问题。';
   if(chat.messages[i-1]?.role==='user')chat.messages[i-1].failed=true;
   changed=true;
  }
 }
 return changed;
}
// Web Locks are released by the browser when a document closes or crashes.
// They distinguish a live peer from a recently closed generating window.
export async function generationLease(id){
 let release=()=>{};const locks=globalThis.navigator?.locks;
 if(locks){let ready;const started=new Promise(r=>ready=r);locks.request('note-chat-generation:'+id,async()=>{await new Promise(r=>{release=r;ready();});}).catch(()=>ready());await started;}
 return {close:()=>release()};
}
export async function generationAlive(message){
 if(globalThis.navigator?.locks){try{return await navigator.locks.request('note-chat-generation:'+message.generationId,{ifAvailable:true},lock=>!lock);}catch{}}
 // Hosts without Web Locks retain a conservative lease; heartbeats continue
 // even when the model is thinking and no text arrives.
 return Date.now()-(message.heartbeatAt||message.startedAt)<120000;
}
export function streamCheckpoint(write,onError=()=>{},{delay=250,heartbeat=5000}={}){
 let timer,closed=false,inflight=null,requested=false;
 // Coalesce while a slow disk write is running instead of queuing one full
 // snapshot per delta interval. The trailing write captures the latest state.
 const flush=()=>{clearTimeout(timer);timer=null;if(inflight){requested=true;return inflight;}requested=false;
  inflight=Promise.resolve().then(write).catch(onError).finally(()=>{inflight=null;if(requested)void flush();});return inflight;};
 const interval=setInterval(()=>{if(!closed)void flush();},heartbeat);
 return {schedule(){if(!closed&&!timer)timer=setTimeout(()=>void flush(),delay);},flush,close(){closed=true;clearTimeout(timer);clearInterval(interval);}};
}
