/**
 * lib/document-extract/providers/mammoth-provider.mjs — lightweight DOCX extraction via mammoth.
 *
 * Wave-1 extraction-provider adapter for Office Open XML word documents. Returns
 * the shared extractor envelope so the quality-aware ladder can prefer mammoth for
 * equivalent-fidelity DOCX before escalating to Docling.
 */

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
 * @returns {Promise<{text:string, extractionMethod:'mammoth'}>}
 */
export async function extractDocxWithMammoth(filePath) {
  const mammoth = (await import('mammoth')).default;
  const { value } = await mammoth.extractRawText({ path: filePath });
  return { text: normalizeText(value || ''), extractionMethod: 'mammoth' };
}

export async function mammothAvailable() {
  try {
    await import('mammoth');
    return true;
  } catch {
    return false;
  }
}
