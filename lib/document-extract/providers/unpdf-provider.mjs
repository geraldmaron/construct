/**
 * lib/document-extract/providers/unpdf-provider.mjs — lightweight PDF extraction via unpdf.
 *
 * Wave-1 extraction-provider adapter for digital-text PDFs. Returns the shared
 * extractor envelope ({ text, extractionMethod, droppedInfo }) plus probe metadata
 * (pageCount, charsPerPage) so the quality-aware ladder can decide whether unpdf
 * sufficed or a Docling tier is required.
 */

import { readFileSync } from 'node:fs';

function normalizeText(value) {
  return String(value)
    .replace(/\r\n/g, '\n')
    .replace(/\u0000/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * @param {string} filePath
 * @returns {Promise<{text:string, pageCount:number, charsPerPage:number, extractionMethod:'unpdf'}>}
 */
export async function extractPdfWithUnpdf(filePath) {
  const { extractText, getDocumentProxy } = await import('unpdf');
  const proxy = await getDocumentProxy(new Uint8Array(readFileSync(filePath)));
  const pageCount = Number(proxy.numPages) || 1;
  const { text: rawText } = await extractText(proxy, { mergePages: true });
  const text = normalizeText(typeof rawText === 'string' ? rawText : (Array.isArray(rawText) ? rawText.join('\n') : ''));
  const charsPerPage = pageCount > 0 ? text.length / pageCount : text.length;
  return { text, pageCount, charsPerPage, extractionMethod: 'unpdf' };
}

export async function unpdfAvailable() {
  try {
    await import('unpdf');
    return true;
  } catch {
    return false;
  }
}
