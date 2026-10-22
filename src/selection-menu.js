// Capture reading-view text before opening a menu changes focus or selection.
export function readingSelection(event, views) {
  const target = event.target?.nodeType === 3 ? event.target.parentElement : event.target;
  if (!target || target.closest?.('input,textarea,[contenteditable="true"],.cm-editor')) return null;
  const doc = target.ownerDocument, selection = doc?.defaultView?.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
  for (const view of views) {
    const pdf = view.file?.extension === 'pdf';
    if (!pdf && (view.file?.extension !== 'md' || view.getMode?.() !== 'preview')) continue;
    const root = pdf ? view.contentEl || view.containerEl : view.previewMode?.containerEl;
    if (!root?.contains(target)) continue;
    let inside = true;
    for (let n = 0; n < selection.rangeCount; n++) {
      const range = selection.getRangeAt(n);
      if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) { inside = false; break; }
    }
    const text = selection.toString().trim();
    if (inside && text) return {text, file: view.file};
  }
  return null;
}
export function readingContextMenu(event, views, {menuForEvent, stage, copy}) {
  const selected = readingSelection(event, views);
  if (!selected) return false;
  event.preventDefault(); event.stopPropagation();
  const menu = menuForEvent(event);
  menu.addItem(item => item.setTitle('复制').setIcon('copy').onClick(() => copy(selected.text)));
  menu.addItem(item => item.setTitle('发送到伴读侧栏（草稿）').setIcon('messages-square').onClick(() => stage(selected.text, selected.file)));
  menu.showAtPosition({x: event.pageX, y: event.pageY}, event.target.ownerDocument);
  return true;
}
