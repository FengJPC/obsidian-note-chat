import test from 'node:test';
import assert from 'node:assert/strict';
import {readPdfWindow} from '../src/pdf-window.js';
import {pdfReadOptions} from '../src/pdf-options.js';

function fixture(current, total = 300, body = n => 'BOOK_PAGE_' + n) {
  const calls = [], file = {path: 'private/books/book.pdf', name: 'book.pdf', stat: {size: 200000000}};
  const doc = {numPages: total, async getPage(n) {
    calls.push(n);
    return {async getTextContent() {return {items: [{str: body(n), hasEOL: true}]};}, cleanup() {throw Error('Must not clean up the reader page');}};
  }, destroy() {throw Error('Must not destroy the reader document');}};
  const reader = {pdfDocument: doc, pdfViewer: {currentPageNumber: current}};
  const view = {file, viewer: {child: {pdfViewer: reader}}};
  return {calls, file, doc, reader, view};
}

test('reading a large book extracts only the current physical PDF page and its two neighbors', async () => {
  const f = fixture(180), result = await readPdfWindow(f.view, f.file);
  assert.deepEqual(f.calls, [179,180,181]);
  assert.deepEqual(result.pageRange, {start:179,end:181,current:180,total:300});
  assert.ok(result.name.includes('179–181'));
  assert.ok(result.text.includes('BOOK_PAGE_180'));
  assert.ok(!result.text.includes('BOOK_PAGE_1\n'));
  assert.ok(result.text.includes('不是书内印刷页码'));
  assert.equal(result.pdfBase64, undefined);
  f.reader.pdfViewer.currentPageNumber = 220;
  const next = await readPdfWindow(f.view, f.file);
  assert.equal(next.pageRange.current, 220);
  assert.deepEqual(f.calls.slice(3), [219,220,221]);
  assert.ok(!result.text.includes('BOOK_PAGE_220'));
});

test('first, last, and single-page books clamp the window without inventing pages', async () => {
  for (const [current,total,expected] of [[1,10,[1,2]],[10,10,[9,10]],[1,1,[1]]]) {
    const f = fixture(current,total);
    await readPdfWindow(f.view, f.file);
    assert.deepEqual(f.calls, expected);
  }
});

test('unknown page, unopened or different PDF never falls back to the beginning or whole book', async () => {
  for (const current of [undefined,0,-1,301,1.5,'5']) {
    const f = fixture(current);
    await assert.rejects(readPdfWindow(f.view,f.file), /当前页码/);
    assert.deepEqual(f.calls, []);
  }
  const f = fixture(5);
  await assert.rejects(readPdfWindow(undefined,f.file), /先打开/);
  await assert.rejects(readPdfWindow(f.view,{path:'other.pdf'}), /先打开/);
  assert.deepEqual(f.calls, []);
});

test('a PDF switched during extraction is rejected without reading further pages', async () => {
  const f = fixture(10);
  f.doc.getPage = async n => {f.calls.push(n);f.reader.pdfDocument={};return {getTextContent() {throw Error('Stale page');}};};
  await assert.rejects(readPdfWindow(f.view,f.file), /关闭或切换/);
  assert.deepEqual(f.calls,[9]);
});

test('blank scanned pages report missing text; bounded extraction marks truncation', async () => {
  const blank = fixture(5,10,()=> '');
  await assert.rejects(readPdfWindow(blank.view,blank.file), /截图/);
  const large = fixture(5,10,()=> 'a'.repeat(130000));
  const result = await readPdfWindow(large.view,large.file);
  assert.equal(result.truncated,true);
  assert.ok(result.text.includes('已截断'));
  assert.ok(result.text.length<121000);
  assert.deepEqual(large.calls,[4]);
});

test('PDF options retain old defaults, accept zero neighbors and bound malformed settings', () => {
  assert.deepEqual(pdfReadOptions(),{mode:'window',before:1,after:1});
  assert.deepEqual(pdfReadOptions({mode:'window',before:0,after:3}),{mode:'window',before:0,after:3});
  assert.deepEqual(pdfReadOptions({mode:'unknown',before:-8,after:999}),{mode:'window',before:0,after:100});
  assert.deepEqual(pdfReadOptions({mode:'all',before:NaN,after:1.5}),{mode:'all',before:1,after:1});
});

test('current-page and asymmetric windows read the configured pages only', async () => {
  for(const [options,expected] of [[{mode:'current',before:50,after:50},[5]], [{mode:'window',before:2,after:0},[3,4,5]], [{mode:'window',before:0,after:2},[5,6,7]]]) {
    const f=fixture(5,10);
    const result=await readPdfWindow(f.view,f.file,options);
    assert.deepEqual(f.calls,expected);assert.equal(result.pdfMode,options.mode);
  }
});

test('full-document mode reads beyond 60 pages and never labels a truncated result as full text', async () => {
  const f=fixture(5,70);
  const result=await readPdfWindow(f.view,f.file,{mode:'all'});
  assert.equal(f.calls.length,70);assert.equal(f.calls.at(-1),70);
  assert.equal(result.truncated,false);assert.ok(result.name.includes('全文'));
  assert.ok(!result.text.includes('未读取全书'));assert.ok(result.text.includes('BOOK_PAGE_70'));
  const oversized=fixture(5,10,()=> 'a'.repeat(130000));
  await assert.rejects(readPdfWindow(oversized.view,oversized.file,{mode:'all'}),/全文超过.*未添加到草稿/);
  assert.deepEqual(oversized.calls,[1]);
});
