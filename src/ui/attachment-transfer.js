export function transferFiles(data){
 const files=Array.from(data?.files||[]);if(files.length)return files;
 return Array.from(data?.items||[]).filter(item=>item.kind==='file').map(item=>item.getAsFile()).filter(Boolean);
}
export function isFileTransfer(data){return Array.from(data?.types||[]).includes('Files')||Array.from(data?.items||[]).some(item=>item.kind==='file');}
