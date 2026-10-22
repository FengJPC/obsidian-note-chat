import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';

export const isChatKey=key=>key==='chatStore'||key==='chatLegacyBackup'||key.startsWith('chat:');
// Separate chat files keep saveData(data.json) independent of all chat bodies.
// Temp + rename makes each write atomic. chatAction commits the index last.
export class ChatStorage {
 constructor(directory,fallback,notify=()=>{},migrated=async()=>{}){Object.assign(this,{directory,fallback,notify,migrated});}
 file(key){return path.join(this.directory,key==='chatStore'?'index.json':key==='chatLegacyBackup'?'legacy-backup.json':createHash('sha256').update(key).digest('hex')+'.json');}
 async get(keys){const out={};for(const key of typeof keys==='string'?[keys]:keys){if(!isChatKey(key)){Object.assign(out,await this.fallback.get([key]));continue;}try{out[key]=JSON.parse(await fs.readFile(this.file(key),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;if(key==='chatStore')Object.assign(out,await this.fallback.get([key]));}}return out;}
 async set(values){const changes={};await fs.mkdir(this.directory,{recursive:true});
  for(const [key,value]of Object.entries(values)){if(!isChatKey(key)){await this.fallback.set({[key]:value});continue;}
   const file=this.file(key),temp=file+'.'+randomUUID()+'.tmp';
   try{await fs.writeFile(temp,JSON.stringify(value),'utf8');await fs.rename(temp,file);}finally{await fs.rm(temp,{force:true}).catch(()=>{});}
   // Do not broadcast legacy backups or every migration body to every window.
   if(key!=='chatLegacyBackup')changes[key]={newValue:value};
   if(key==='chatStore'&&value.version===2)await this.migrated();
  }
  if(Object.keys(changes).length)this.notify(changes);
 }
 async remove(keys){for(const key of typeof keys==='string'?[keys]:keys){if(isChatKey(key))await fs.rm(this.file(key),{force:true});else await this.fallback.remove([key]);}}
}
