// Each repository ships its own modules. Verify the recorded interface bundle locally,
// and optionally compare a second checkout without creating a build dependency on it.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const moduleRoot=repo=>fs.existsSync(path.join(repo,'extension'))?path.join(repo,'extension'):path.join(repo,'src/shared');
const manifestPath=path.join(root,'shared-modules.json'),manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file,'utf8').replace(/\r\n/g,'\n')).digest('hex');
const peerIndex=process.argv.indexOf('--peer'),peer=peerIndex<0?null:process.argv[peerIndex+1];
if(peerIndex>=0&&!peer)throw new Error('--peer requires a checkout path');
const failures=[];
for(const name of Object.keys(manifest.files)){
 if(!/^[a-z-]+\.js$/.test(name))throw new Error('Invalid shared module name');
 const actual=hash(path.join(moduleRoot(root),name));
 if(process.argv.includes('--record'))manifest.files[name]=actual;
 else if(actual!==manifest.files[name])failures.push(name+' differs from its recorded shared revision');
 if(peer&&actual!==hash(path.join(moduleRoot(path.resolve(peer)),name)))failures.push(name+' differs between repositories');
}
if(failures.length)throw new Error(failures.join('\n'));
if(process.argv.includes('--record'))fs.writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+'\n');
console.log('Shared modules verified: '+Object.keys(manifest.files).length+(peer?' (including peer checkout)':''));
