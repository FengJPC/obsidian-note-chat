// Obsidian's PDF view wraps its PDF.js application in viewer.child.
// This adapter only reads the already-open document; it never changes pages,
// cleans up shared PDF.js objects, or falls back to reading the whole file.
function reading(view, file) {
  const reader = view?.viewer?.child?.pdfViewer;
  const doc = reader?.pdfDocument;
  if (view?.file !== file || !doc || typeof doc.getPage !== 'function') {
    throw new Error('请先打开这份 PDF，等待页面加载后再读取当前页。');
  }
  const current = reader.pdfViewer?.currentPageNumber;
  const total = doc.numPages;
  if (!Number.isInteger(total) || total < 1 || !Number.isInteger(current) || current < 1 || current > total) {
    throw new Error('无法确认 PDF 当前页码，请在阅读器中定位页面后重试。');
  }
  return {reader, doc, current, total};
}

export async function readPdfWindow(view, file) {
  const {reader, doc, current, total} = reading(view, file);
  const start = Math.max(1, current - 1), end = Math.min(total, current + 1);
  const range = {start, end, current, total};
  let expired = false, timer;
  const ensureSame = () => {
    if (expired) throw new Error('读取 PDF 当前页超时，请等待页面加载后重试。');
    if (view.file !== file || view.viewer?.child?.pdfViewer !== reader || reader.pdfDocument !== doc) {
      throw new Error('读取期间 PDF 已关闭或切换，请重新读取当前页。');
    }
  };
  const extract = async () => {
    let text = '', hasText = false, truncated = false;
    for (let n = start; n <= end; n++) {
      ensureSame();
      const page = await doc.getPage(n);
      ensureSame();
      const content = await page.getTextContent();
      ensureSame();
      const body = content.items.map(i => typeof i.str === 'string' ? i.str + (i.hasEOL ? '\n' : ' ') : '').join('');
      if (body.trim()) hasText = true;
      const piece = '\n\n[第 ' + n + ' 页]\n' + body;
      const remaining = 120000 - text.length;
      text += piece.slice(0, remaining);
      if (piece.length > remaining || (text.length >= 120000 && n < end)) { truncated = true; break; }
    }
    if (!hasText) throw new Error('当前 PDF 页码范围没有可提取的文字，可能是扫描版；请粘贴页面截图。');
    const label = 'PDF 第 ' + start + '–' + end + ' 页（当前第 ' + current + ' 页，共 ' + total + ' 页）';
    const header = '[' + label + '；页码为 PDF 文件页序，不是书内印刷页码。仅提供此范围，未读取全书。]';
    return {text: header + text + (truncated ? '\n[此范围内容已截断：最多 120000 字符]' : ''), pageRange: range, truncated,
      name: (file.name || file.path.split('/').at(-1)) + ' · ' + label};
  };
  try {
    return await Promise.race([extract(), new Promise((_, reject) => {
      timer = setTimeout(() => { expired = true; reject(new Error('读取 PDF 当前页超时，请等待页面加载后重试。')); }, 20000);
    })]);
  } finally { clearTimeout(timer); }
}
