export function exportFolder(value) {
  const parts = String(value || 'AI 对话').replaceAll('\\', '/').split('/');
  if (parts.some(p => !p || p.startsWith('.') || /[<>:"|?*\x00-\x1f]/.test(p) || /[. ]$/.test(p) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p))) throw new Error('导出目录必须是库内的普通相对目录，不能包含 .. 或隐藏配置目录。');
  return parts.join('/');
}
export function safeFilename(value) {
  let name = String(value).replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').replace(/^[. ]+|[. ]+$/g, '').slice(0, 140);
  if (!/\.(md|txt|csv|json|html|tex|xml|yaml|yml|log)$/i.test(name)) throw new Error('只允许保存文本类文件。');
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = '_' + name;
  return name;
}
export async function saveExport(vault, folder, name, content) {
  const target = exportFolder(folder), filename = safeFilename(name);
  if (typeof content !== 'string' || new TextEncoder().encode(content).length > 30_000_000) throw new Error('导出内容过大或无效。');
  let prefix = '';
  for (const part of target.split('/')) {
    prefix = prefix ? prefix + '/' + part : part;
    if (!vault.getAbstractFileByPath(prefix)) {
      try { await vault.createFolder(prefix); }
      catch (e) { if (!vault.getAbstractFileByPath(prefix)) throw e; }
    }
  }
  const dot = filename.lastIndexOf('.');
  for (let n = 0; n < 100; n++) {
    const suffix = n ? '-' + new Date().toISOString().replace(/[:.]/g, '-') + '-' + n : '';
    const path = target + '/' + filename.slice(0, dot) + suffix + filename.slice(dot);
    if (vault.getAbstractFileByPath(path)) continue;
    try { await vault.create(path, content); return path; }
    catch (e) { if (!vault.getAbstractFileByPath(path)) throw e; }
  }
  throw new Error('存在过多同名导出文件，请修改标题后重试。');
}
