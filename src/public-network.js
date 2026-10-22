import https from 'node:https';
import dns from 'node:dns/promises';
import {isIP} from 'node:net';
import {publicUrl} from './shared/public-sources.js';

// Public downloads never use officialFetch, account tokens, cookies or proxies.
// Resolve once and pin the validated IP into the connection's lookup callback.
export function publicAddress(address) {
  if (isIP(address) === 4) {
    const [a,b,c] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      a === 100 && b >= 64 && b <= 127 || a === 169 && b === 254 ||
      a === 172 && b >= 16 && b <= 31 || a === 192 && (b === 168 || b === 0 && (c === 0 || c === 2) || b === 88 && c === 99) ||
      a === 198 && (b === 18 || b === 19 || b === 51 && c === 100) || a === 203 && b === 0 && c === 113);
  }
  if (isIP(address) === 6) {
    // Only ordinary global unicast, excluding special-purpose/tunnel/documentation ranges.
    const [a,b] = address.toLowerCase().split(':').map(n => parseInt(n || '0',16));
    return a >= 0x2000 && a <= 0x3fff && a !== 0x2002 &&
      !(a === 0x2001 && (b <= 0x1ff || b === 0xdb8)) && !(a === 0x3fff && b <= 0xfff);
  }
  return false;
}

// Some desktop proxies return synthetic benchmark IPs. Resolve those names via
// a fixed, TLS-verified public resolver instead of allowing the synthetic range.
// Only the hostname is sent; never a URL path, query, cookie or account token.
export function cloudflareLookup(hostname, {signal, request=https.request}={}) {
  const url=new URL('https://cloudflare-dns.com/dns-query');url.search=new URLSearchParams({name:hostname,type:'A'});
  return new Promise((resolve,reject)=>{
    const req=request(url,{method:'GET',agent:false,signal,headers:{Accept:'application/dns-json'},
      lookup:(_host,options,done)=>done(null,...(options?.all?[[{address:'1.1.1.1',family:4}]]:['1.1.1.1',4])),
    },response=>{
      if(response.statusCode!==200){response.destroy();reject(new Error('公共 DNS 解析失败：HTTP '+response.statusCode));return;}
      let size=0;const chunks=[];response.on('error',reject);response.on('aborted',()=>reject(new Error('公共 DNS 响应中断。')));
      response.on('data',chunk=>{size+=chunk.length;if(size>65536){response.destroy(new Error('公共 DNS 响应过大。'));return;}chunks.push(chunk);});
      response.on('end',()=>{try{const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(data.Status!==0)throw new Error('公共 DNS 未能解析该域名。');resolve((data.Answer||[]).filter(r=>r.type===1).map(r=>({address:r.data,family:4})));}catch(e){reject(e);}});
    });req.on('error',reject);req.end();
  });
}

export async function resolvePublicAddresses(hostname,{signal,lookup=dns.lookup,publicLookup=cloudflareLookup}={}) {
  let addresses=await lookup(hostname,{all:true,verbatim:true});
  if(addresses.length&&addresses.every(a=>isIP(a.address)===4&&/^198\.(18|19)\./.test(a.address))) addresses=await publicLookup(hostname,{signal});
  if(!addresses.length||addresses.some(a=>!publicAddress(a.address)))throw new Error('拒绝访问本地、内网或保留网络地址。');
  return addresses;
}

export async function downloadPublic(value, {signal, lookup = dns.lookup, publicLookup=cloudflareLookup, request = https.request, timeoutMs = 30000} = {}) {
  const url = new URL(publicUrl(value));
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  signal?.addEventListener('abort', abort, {once:true});
  if (signal?.aborted) abort();
  const timer = setTimeout(() => controller.abort(new Error('公共网页读取超过 30 秒，已停止。')), timeoutMs);
  let rejectAbort;
  const interrupted = new Promise((_, reject) => {rejectAbort = () => reject(controller.signal.reason || new Error('已停止读取。'));controller.signal.addEventListener('abort', rejectAbort, {once:true});});
  try {
    controller.signal.throwIfAborted();
    const addresses = await Promise.race([resolvePublicAddresses(url.hostname,{signal:controller.signal,lookup,publicLookup}), interrupted]);
    controller.signal.throwIfAborted();
    const selected = addresses[0];
    return await Promise.race([new Promise((resolve,reject) => {
      const req = request(url, {
        method:'GET', agent:false, signal:controller.signal,
        headers:{Accept:'text/html,application/xhtml+xml,application/pdf,text/plain,text/markdown', 'Accept-Encoding':'identity'},
        lookup:(_host,options,done) => done(null,...(options?.all ? [[selected]] : [selected.address,selected.family])),
      }, response => {
        const status = response.statusCode, type = String(response.headers['content-type'] || '').slice(0,150);
        const result = {status, url:url.href, headers:{'content-type':type}, bodyBase64:''};
        // Never follow redirects or send error bodies to the UI.
        if (status < 200 || status >= 300) {response.destroy();resolve(result);return;}
        if (!/^(?:text\/(?:html|plain|markdown)|application\/(?:xhtml\+xml|pdf))(?:;|$)/i.test(type)) {response.destroy();resolve(result);return;}
        if (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity') {response.destroy();reject(new Error('不支持压缩的公共下载响应。'));return;}
        const limit = /^application\/pdf(?:;|$)/i.test(type) ? 20_000_000 : 2_000_000;
        if (Number(response.headers['content-length']) > limit) {response.destroy();reject(new Error('公共资料超过下载大小限制。'));return;}
        const chunks=[];let size=0;
        response.on('error',reject);
        response.on('aborted',()=>reject(new Error('公共资料下载中断。')));
        response.on('data',chunk=>{size+=chunk.length;if(size>limit){response.destroy(new Error('公共资料超过下载大小限制。'));return;}chunks.push(chunk);});
        response.on('end',()=>resolve({...result,bodyBase64:Buffer.concat(chunks).toString('base64')}));
      });
      req.on('error',reject);req.end();
    }),interrupted]);
  } finally {
    clearTimeout(timer);signal?.removeEventListener('abort',abort);controller.signal.removeEventListener('abort',rejectAbort);
  }
}
