/**
 * Extracts the text of a PDF in the browser. The file never leaves the device; only the
 * balance the person confirms is saved. Loaded on demand, since pdf.js is large.
 */
export async function pdfText(file: File, maxPages = 12): Promise<string> {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const doc = await task.promise;
  const pages: string[] = [];
  for (let i = 1; i <= Math.min(doc.numPages, maxPages); i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    pages.push(content.items.map((it) => ('str' in it ? `${it.str}${it.hasEOL ? '\n' : ' '}` : '')).join(''));
  }
  await task.destroy();
  return pages.join('\n');
}
