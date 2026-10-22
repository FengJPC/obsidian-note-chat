export async function readPDF(bytes){const {pdfText}=await import('./pdf-reader.js');return pdfText(bytes);}
export async function uploadMaterial(file){
 if(file.size>20000000)throw new Error('上传文件最多 20 MB。');
 if(/\.(png|jpe?g|webp)$/i.test(file.name)||/^image\/(png|jpeg|webp)$/.test(file.type)){
  let bitmap;try{bitmap=await createImageBitmap(file);}catch{throw new Error('无法读取图片，请使用有效的 PNG、JPG 或 WebP 文件。');}
  try{const ratio=Math.min(1,2048/Math.max(bitmap.width,bitmap.height));const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*ratio));canvas.height=Math.max(1,Math.round(bitmap.height*ratio));canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);const image=canvas.toDataURL(file.type==='image/jpeg'?'image/jpeg':'image/png',0.9);return {id:crypto.randomUUID(),name:file.name||'粘贴的图片.png',image};}finally{bitmap.close();}
 }
 let text;
 if(/\.pdf$/i.test(file.name))text=await readPDF(new Uint8Array(await file.arrayBuffer()));
 else{if(!/\.(txt|md|csv|json|tex|html|xml|yaml|yml|log)$/i.test(file.name))throw new Error('目前支持 PNG/JPG/WebP 图片、PDF 和文本类文件。');const full=await file.text();text=full.slice(0,120000)+(full.length>120000?'\n[已截断，仅提供前 120000 字符]':'');if(text.includes('\u0000'))throw new Error('文件不是可读取的文本。');}
 return {id:crypto.randomUUID(),name:file.name,text};
}
export async function obtainMaterial(mode){
 if(mode!=='read')throw new Error('第一版只读取当前笔记；图片请粘贴或上传。');
 const r=await chrome.runtime.sendMessage({type:'readNote'});
 if(!r?.ok)throw new Error(r?.error||'没有找到当前笔记');return decodeMaterial(r.material);
}
export async function decodeMaterial(material){
 if(!material?.pdfBase64)return material;
 const bytes=Uint8Array.from(atob(material.pdfBase64),c=>c.charCodeAt(0));
 if(bytes.byteLength>20000000)throw new Error('上传文件最多 20 MB。');
 const text=await readPDF(bytes);
 return {id:material.id,name:material.name,url:material.url,text};
}
