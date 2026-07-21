/**
 * lib/document-extract/routing-thresholds.mjs — calibrated extraction routing thresholds.
 *
 * Values are derived from the document-extraction corpus benchmark
 * (construct-tsyfe.2.9, tests/fixtures/document-extraction-corpus/). The benchmark
 * compares unpdf/mammoth against Docling on representative PDF/DOCX fixtures and
 * records when lightweight parsers preserve sufficient text fidelity versus when
 * layout-critical or scanned content requires Docling.
 */

export const ROUTING_THRESHOLDS = Object.freeze({
  pdf: Object.freeze({
    minCharsPerPageForLightweight: 50,
    singlePageAlwaysLightweightIfNonEmpty: true,
    emptyTextRequiresDocling: true,
  }),
  docx: Object.freeze({
    preferLightweightWhenTextNonEmpty: true,
    escalateToDoclingWhenHighFidelityAnd: Object.freeze(['hasTable', 'hasEmbeddedImage']),
  }),
});

export const MIN_TEXT_DENSITY_CHARS_PER_PAGE = ROUTING_THRESHOLDS.pdf.minCharsPerPageForLightweight;

export function isDigitalTextPdf({ text, pageCount, charsPerPage }) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return false;
  const pages = Number(pageCount) > 0 ? Number(pageCount) : 1;
  const density = Number.isFinite(charsPerPage)
    ? charsPerPage
    : trimmed.length / pages;
  if (pages === 1 && ROUTING_THRESHOLDS.pdf.singlePageAlwaysLightweightIfNonEmpty) return true;
  return density >= MIN_TEXT_DENSITY_CHARS_PER_PAGE;
}
