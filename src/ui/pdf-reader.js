import {getDocument,GlobalWorkerOptions} from './vendor/pdfjs/pdf.mjs';
import workerSource from './vendor/pdfjs/pdf.worker.mjs?raw';
import fontAssets from './pdf-assets.json';
GlobalWorkerOptions.workerSrc=URL.createObjectURL(new Blob([workerSource],{type:'text/javascript'}));
function asset(name){const encoded=fontAssets[name];if(!encoded)throw new Error('Missing bundled PDF asset: '+name);return Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));}
class CMapFactory{async fetch({name}){return {cMapData:asset('cmaps/'+name+'.bcmap'),compressionType:1};}}
class FontFactory{async fetch({filename}){return asset('standard_fonts/'+filename);}}
export async function pdfText(bytes){
 const task=getDocument({data:bytes,isEvalSupported:false,useWasm:false,useWorkerFetch:false,CMapReaderFactory:CMapFactory,StandardFontDataFactory:FontFactory,cMapPacked:true});let doc;
 try{doc=await task.promise;let text='';const count=Math.min(doc.numPages,60);
  for(let n=1;n<=count&&text.length<120000;n++){const page=await doc.getPage(n);const content=await page.getTextContent();text+='\n\n[第 '+n+' 页]\n'+content.items.map(i=>i.str+(i.hasEOL?'\n':' ')).join('');page.cleanup();}
  if(!text.replace(/\[第 \d+ 页\]/g,'').trim())throw new Error('PDF 没有可提取的文字，可能是扫描版；请改用截图。');
  return text.slice(0,120000)+(doc.numPages>count||text.length>120000?'\n[内容已截断：最多 60 页、120000 字符]':'');
 }catch(e){if(e.name==='PasswordException')throw new Error('PDF 需要密码，请先解锁后再上传。');throw e;}finally{await task.destroy();}
}
