export function generationWatch(controller,{idleMs=180000,totalMs=900000,onTick=()=>{}}={}) {
 const started=Date.now();let last=started,phase='正在连接',timeout='';
 const timer=setInterval(()=>{
  const now=Date.now();
  if(now-started>=totalMs||now-last>=idleMs){timeout=now-started>=totalMs?'生成超过 15 分钟，已停止。':'连接连续 3 分钟没有新进展，已停止。';controller.abort();}
  else onTick(`${phase} · ${Math.floor((now-started)/1000)} 秒`);
 },Math.min(1000,idleMs,totalMs));
 return {progress(next){last=Date.now();if(next)phase=next;},get timeout(){return timeout;},close(){clearInterval(timer);}};
}
export function recoverInterrupted(chat){
 let changed=false;
 for(let i=0;i<chat.messages.length;i++){
  const m=chat.messages[i];
  if(m.role==='assistant'&&(m.pending||!m.content&&!m.failed&&!m.files?.length)){
   m.pending=false;m.failed=true;m.content ||= '上次生成已中断。可以重新发送问题。';
   if(chat.messages[i-1]?.role==='user')chat.messages[i-1].failed=true;
   changed=true;
  }
 }
 return changed;
}
