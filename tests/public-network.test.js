import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {downloadPublic,publicAddress,resolvePublicAddresses,cloudflareLookup} from '../src/public-network.js';

const lookup=async()=>[{address:'93.184.216.34',family:4}];
function fixture({status=200,type='text/plain',headers={},body=Buffer.from('public text'),hang=false}={}) {
  const calls=[];
  const request=(url,options,callback)=>{
    const req=new EventEmitter();calls.push({url,options});
    req.end=()=>queueMicrotask(()=>{
      const response=new PassThrough();response.statusCode=status;response.headers={'content-type':type,...headers};
      options.signal?.addEventListener('abort',()=>{response.destroy();req.emit('error',new Error('aborted'));},{once:true});
      callback(response);if(!hang&&!response.destroyed)response.end(body);
    });return req;
  };
  return {request,calls};
}
test('public DNS validation blocks private, mapped, multicast and reserved IPs',async()=>{
  for(const ip of ['127.0.0.1','10.0.0.1','172.31.1.1','192.168.1.1','169.254.169.254','100.64.0.1','0.0.0.0','198.18.0.1','224.1.1.1','::1','::ffff:127.0.0.1','fc00::1','fe80::1','ff02::1','2001:db8::1','2002:7f00:1::'])assert.equal(publicAddress(ip),false,ip);
  for(const ip of ['8.8.8.8','93.184.216.34','192.0.78.13','192.2.0.1','2606:4700:4700::1111'])assert.equal(publicAddress(ip),true,ip);
  const f=fixture();
  for(const records of [[{address:'127.0.0.1',family:4}],[...(await lookup()),{address:'10.0.0.1',family:4}],[]])await assert.rejects(downloadPublic('https://example.com',{...f,lookup:async()=>records}),/内网/);
  assert.equal(f.calls.length,0);
});
test('public download pins DNS and sends no tokens, cookies or referrer; binary bytes round trip',async()=>{
  const bytes=Buffer.from([0,255,17,200]),f=fixture({type:'application/pdf',body:bytes});let resolutions=0;
  const result=await downloadPublic('https://example.com/paper.pdf',{...f,lookup:async()=>{resolutions++;return lookup();}});
  assert.equal(resolutions,1);assert.deepEqual(Buffer.from(result.bodyBase64,'base64'),bytes);
  const opts=f.calls[0].options;assert.equal(opts.agent,false);assert.equal(opts.method,'GET');
  assert.deepEqual(Object.keys(opts.headers).sort(),['Accept','Accept-Encoding']);
  opts.lookup('example.com',{},(err,ip,family)=>{assert.equal(err,null);assert.equal(ip,'93.184.216.34');assert.equal(family,4);});
  opts.lookup('example.com',{all:true},(err,ips)=>assert.deepEqual(ips,[{address:'93.184.216.34',family:4}]));
});
test('redirects and HTTP errors never follow links or return response bodies',async()=>{
  for(const status of [302,403,429]){
    const f=fixture({status,headers:{location:'https://127.0.0.1/private'},body:Buffer.from('private')});
    const result=await downloadPublic('https://example.com',{...f,lookup});
    assert.equal(result.status,status);assert.equal(result.bodyBase64,'');assert.equal(f.calls.length,1);
  }
});
test('size limits apply to declared and streamed bytes; unexpected compressed content is refused',async()=>{
  for(const options of [{headers:{'content-length':'2000001'}},{body:Buffer.alloc(2000001)},{type:'application/pdf',headers:{'content-length':'20000001'}}]){
    await assert.rejects(downloadPublic('https://example.com',{...fixture(options),lookup}),/大小限制/);
  }
  await assert.rejects(downloadPublic('https://example.com',{...fixture({headers:{'content-encoding':'gzip'}}),lookup}),/压缩/);
});
test('cancellation and total deadline cover DNS and response download',async()=>{
  const f=fixture(),controller=new AbortController();
  const pending=downloadPublic('https://example.com',{...f,lookup:()=>new Promise(()=>{}),signal:controller.signal});controller.abort();await assert.rejects(pending);assert.equal(f.calls.length,0);
  await assert.rejects(downloadPublic('https://example.com',{...f,lookup:()=>new Promise(()=>{}),timeoutMs:15}),/30 秒/);
  await assert.rejects(downloadPublic('https://example.com',{...fixture({hang:true}),lookup,timeoutMs:15}));
});

test('proxy synthetic DNS falls back to a public resolver and revalidates the returned addresses',async()=>{
  let fallbacks=0;const synthetic=async()=>[{address:'198.18.0.76',family:4}];
  const options={lookup:synthetic,publicLookup:async name=>{fallbacks++;assert.equal(name,'example.com');return lookup();}};
  assert.deepEqual(await resolvePublicAddresses('example.com',options),await lookup());assert.equal(fallbacks,1);
  await assert.rejects(resolvePublicAddresses('example.com',{...options,publicLookup:async()=>[{address:'127.0.0.1',family:4}]}),/内网/);
  await assert.rejects(resolvePublicAddresses('example.com',{...options,lookup:async()=>[{address:'10.0.0.1',family:4}]}),/内网/);assert.equal(fallbacks,1);
  const f=fixture({type:'application/dns-json',body:Buffer.from(JSON.stringify({Status:0,Answer:[{type:1,data:'93.184.216.34'}]}))});
  assert.deepEqual(await cloudflareLookup('example.com',f),await lookup());
  assert.equal(f.calls[0].url.hostname,'cloudflare-dns.com');assert.deepEqual([...f.calls[0].url.searchParams],[['name','example.com'],['type','A']]);
  f.calls[0].options.lookup('cloudflare-dns.com',{},(err,ip)=>assert.equal(ip,'1.1.1.1'));
});
