/**
 * lib/output-quality.mjs — Post-export output validation for the publish path.
 *
 * After an artifact exports, this runs the checks the source-level release gate cannot reach: the
 * produced file is validated for real (PDF page count, exported-text roundtrip against the source
 * headings, on-disk reference integrity), and the brand text palette is asserted against WCAG AA.
 * At render-smoke or higher gate levels the export is additionally rendered to images and the
 * screenshot evidence recorded. Every check degrades with a typed reason when its tool is absent
 * rather than failing the publish; only a real, document-scoped validity failure (a zero-page PDF,
 * dropped content, a missing local reference) marks the result not-ok.
 */

import { validatePdf, contentRoundtrip, referenceIntegrity } from './export-validate.mjs';
import { validateBrandContrast } from './brand-contrast.mjs';
import { captureRenderEvidence } from './render-evidence.mjs';
import { lintDocumentDiagrams } from './diagram-quality.mjs';

const RENDER_GATE_LEVELS = new Set(['render-smoke', 'full-certification', 'human-reviewed']);

// render-pipeline keys an export format to an image renderer; deck is HTML under the hood. A
// format with no renderer skips the screenshot capture rather than guessing one.

function renderFormatFor(format) {
  if (format === 'pdf') return 'pdf';
  if (format === 'html' || format === 'deck') return 'html';
  if (format === 'pptx') return 'pptx';
  return null;
}

export function runOutputQuality({
  exportPath,
  format,
  sourceMarkdown = '',
  baseDir = null,
  gateLevel = 'standard',
  diagramStrict = false,
  rootDir = process.cwd(),
  env = process.env,
} = {}) {
  const checks = {};

  if (format === 'pdf') checks.pdf = validatePdf(exportPath, env);
  checks.roundtrip = contentRoundtrip({ exportPath, format, sourceMarkdown, env });
  if (sourceMarkdown && baseDir) checks.references = referenceIntegrity(sourceMarkdown, baseDir);

  // Diagram legibility is advisory by default; `cx_diagram_quality: strict` escalates it.
  const diagrams = lintDocumentDiagrams(sourceMarkdown);

  // Palette contrast is a brand-system invariant, not a property of this document, so a
  // regression is surfaced as advisory rather than failing the user's publish.

  const contrast = validateBrandContrast();

  let render = null;
  if (RENDER_GATE_LEVELS.has(gateLevel)) {
    const renderFormat = renderFormatFor(format);
    if (renderFormat) render = captureRenderEvidence({ format: renderFormat, inputPath: exportPath, rootDir, env });
  }

  // A typed degradation (tool absent) never fails the publish; only a non-degraded,
  // document-scoped check whose ok is explicitly false does.

  const failures = Object.entries(checks)
    .filter(([, result]) => result && result.ok === false && !result.degradation)
    .map(([name, result]) => `${name}: ${result.message || 'failed'}`);

  if (diagramStrict && !diagrams.ok) {
    for (const w of diagrams.warnings) failures.push(`diagram ${w.diagram} (${w.kind}): ${w.code}`);
  }

  return {
    ok: failures.length === 0,
    gateLevel,
    checks,
    contrast: { ok: contrast.ok, failures: contrast.failures },
    diagrams,
    render,
    failures,
  };
}
