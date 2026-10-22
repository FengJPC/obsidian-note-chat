import {sourceMetadata} from '../shared/public-sources.js';
import {t} from './i18n.js';
export function showPublicSources(chat,download){
 const list=document.getElementById('publicSourceList');list.replaceChildren();
 const sources=[...(chat.publicSources||[])].reverse();
 if(!sources.length){const p=document.createElement('p');p.textContent=t('当前对话还没有资料快照');list.append(p);}
 for(const source of sources){
  const item=document.createElement('details'),title=document.createElement('summary');
  const labels={success:'成功',partial:'部分内容',blocked:'访问受限',timeout:'超时',fetch_error:'获取失败',parse_error:'解析失败',permission_required:'需要授权',internal_error:'工具错误'};
  title.textContent=(source.title||source.requested_url||source.source_id)+' · '+t(labels[source.status]||source.status);item.append(title);
  const meta=document.createElement('p');meta.className='note';meta.textContent=new Date(source.fetched_at).toLocaleString(document.documentElement.lang)+(source.http_status?' · HTTP '+source.http_status:'')+' · '+source.text.length+t(' 字符');item.append(meta);
  if(source.error_message){const error=document.createElement('p');error.className='note';error.textContent=source.error_message;item.append(error);}
  const actions=document.createElement('div');actions.className='row';
  const save=document.createElement('button');save.className='subtle';save.textContent=t('导出快照 TXT');save.onclick=()=>download(source.source_id+'.txt',JSON.stringify(sourceMetadata(source),null,2)+'\n\n'+source.text);actions.append(save);item.append(actions);
  const preview=document.createElement('pre');preview.className='snapshot-text';preview.textContent=source.text.slice(0,12000)||source.error_message||'';item.append(preview);
  if(source.text.length>12000){const note=document.createElement('p');note.className='note';note.textContent=t('预览最多 12000 字符，导出可查看完整的已存快照');item.append(note);}
  if(source.truncated){const note=document.createElement('p');note.className='note';note.textContent=t('资料读取时已截断，快照不代表全文');item.append(note);}
  const advanced=document.createElement('details'),label=document.createElement('summary');label.textContent=t('详细信息');
  const info=document.createElement('pre');info.textContent=JSON.stringify(sourceMetadata(source),null,2);info.className='snapshot-meta';advanced.append(label,info);item.append(advanced);
  list.append(item);
 }
 document.getElementById('publicSourcesDialog').showModal();
}
