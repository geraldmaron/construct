/**
 * kernel/extract/thresholds.ts — calibrated extraction routing thresholds and
 * the predicates that read them. Ported from the predecessor's routing
 * thresholds module; the exact v2 source path is cited in
 * scripts/capture-legacy-ladder-golden.mjs.
 *
 * The values come from v2's document-extraction corpus benchmark, which
 * compared the lightweight parsers against Docling on representative PDF/DOCX
 * fixtures and recorded where lightweight output still preserved enough text
 * fidelity. They are corpus-derived numbers, not guesses, which is why they are
 * carried over as-is rather than re-picked: re-deriving them needs the corpus,
 * and that is a separate piece of work from this harvest.
 */

export interface PdfThresholds {
  readonly minCharsPerPageForLightweight: number;
  readonly singlePageAlwaysLightweightIfNonEmpty: boolean;
  readonly emptyTextRequiresDocling: boolean;
}

export interface DocxThresholds {
  readonly preferLightweightWhenTextNonEmpty: boolean;
  /** Structure signals that force an escalation when high fidelity is asked for. */
  readonly escalateToDoclingWhenHighFidelityAnd: readonly string[];
}

export interface RoutingThresholds {
  readonly pdf: PdfThresholds;
  readonly docx: DocxThresholds;
}

export const ROUTING_THRESHOLDS: RoutingThresholds = Object.freeze({
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

export const MIN_TEXT_DENSITY_CHARS_PER_PAGE =
  ROUTING_THRESHOLDS.pdf.minCharsPerPageForLightweight;

export interface PdfTextYield {
  readonly text?: string | null;
  readonly pageCount?: number | null;
  readonly charsPerPage?: number | null;
}

/**
 * Is this PDF's text layer good enough to stop at the lightweight rung?
 *
 * Empty text means scanned or image-only content, which needs OCR. Otherwise
 * the call is text density per page — with a deliberate carve-out that a
 * single-page PDF with any text at all is accepted, because one page is too
 * small a sample for the density heuristic to be meaningful.
 */
export function isDigitalTextPdf(result: PdfTextYield): boolean {
  const trimmed = String(result?.text ?? '').trim();
  if (!trimmed) return false;
  const pages = Number(result?.pageCount) > 0 ? Number(result.pageCount) : 1;
  const declared = result?.charsPerPage;
  const density = Number.isFinite(declared as number)
    ? (declared as number)
    : trimmed.length / pages;
  if (pages === 1 && ROUTING_THRESHOLDS.pdf.singlePageAlwaysLightweightIfNonEmpty) return true;
  return density >= MIN_TEXT_DENSITY_CHARS_PER_PAGE;
}

export interface DocxStructureSignals {
  readonly hasTable?: boolean;
  readonly hasEmbeddedImage?: boolean;
}

/**
 * Does a DOCX need Docling despite the lightweight parser producing text?
 *
 * Only when high fidelity was asked for AND the document carries structure a
 * text-only parser flattens (a table, an embedded image). Probing for those
 * signals means reading inside the file, which is the host's job — the signals
 * come in as an argument.
 */
export function docxRequiresDoclingEscalation(
  signals: DocxStructureSignals | null | undefined,
  highFidelity = true,
): boolean {
  if (!highFidelity) return false;
  if (!signals) return false;
  return ROUTING_THRESHOLDS.docx.escalateToDoclingWhenHighFidelityAnd.some((signal) =>
    Boolean((signals as Record<string, unknown>)[signal]),
  );
}
