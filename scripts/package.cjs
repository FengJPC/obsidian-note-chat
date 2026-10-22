// Dependency-free ZIP writer; includes the desktop plugin runtime and notices.
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib');
const root=path.resolve(__dirname,'..'),source=path.join(root,'dist','note-chat-sidebar');
const version=JSON.parse(fs.readFileSync(path.join(source,'manifest.json'),'utf8')).version;
if(!/^\d+\.\d+\.\d+$/.test(version))throw new Error('Invalid manifest version');
for(const name of ['LICENSE','NOTICE','THIRD_PARTY_NOTICES.md'])if(!fs.existsSync(path.join(source,name)))throw new Error('Missing bundled notice: '+name);
const table=Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function crc32(data){let crc=0xffffffff;for(const b of data)crc=table[(crc^b)&255]^(crc>>>8);return (crc^0xffffffff)>>>0;}
function files(dir){return fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name)).flatMap(e=>{if(e.isSymbolicLink())throw new Error('Symlinks are not packaged');const p=path.join(dir,e.name);return e.isDirectory()?files(p):[p];});}
const local=[],central=[];let offset=0,count=0;
// Only build products may ship, even when this directory is used as a live
// plugin during development. Never include vault data or migration backups.
const runtime=new Set(['main.js','manifest.json','styles.css','ui.html','ui.js','ui.css','katex.css','LICENSE','NOTICE','THIRD_PARTY_NOTICES.md','README.md','PRIVACY.md']);
const packaged=[...runtime].map(name=>path.join(source,name)).concat(files(path.join(source,'vendor')));
for(const file of packaged){
 const name=Buffer.from('note-chat-sidebar/'+path.relative(source,file).split(path.sep).join('/'),'utf8');
 const data=fs.readFileSync(file),compressed=zlib.deflateRawSync(data),crc=crc32(data);
 const h=Buffer.alloc(30);h.writeUInt32LE(0x04034b50,0);h.writeUInt16LE(20,4);h.writeUInt16LE(0x800,6);h.writeUInt16LE(8,8);h.writeUInt16LE(33,12);h.writeUInt32LE(crc,14);h.writeUInt32LE(compressed.length,18);h.writeUInt32LE(data.length,22);h.writeUInt16LE(name.length,26);
 const c=Buffer.alloc(46);c.writeUInt32LE(0x02014b50,0);c.writeUInt16LE(20,4);h.copy(c,6,4,30);c.writeUInt32LE(offset,42);
 local.push(h,name,compressed);central.push(c,name);offset+=h.length+name.length+compressed.length;count++;
}
const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(count,8);end.writeUInt16LE(count,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
const out=path.join(root,'dist',`note-chat-sidebar-${version}.zip`);fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,Buffer.concat([...local,directory,end]));console.log(`Built ${path.basename(out)} (${count} files)`);
