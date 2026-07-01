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
 *
 * Markup visual gate (HTML only): invisible text (opacity:0, matched fg/bg color) and hard-overlapping
 * absolutely-positioned elements are detected from the produced file's own markup, closing the blind
 * spot where the text roundtrip passes because hidden glyphs are still extractable.
 *
 * Render-smoke hard-fail: for pdf and pptx deliverables at render-smoke+, a missing required renderer
 * is a hard failure rather than a graceful degrade — a user inspecting output before claiming done
 * cannot accept a quality claim that rests on a tool that was never invoked.
 */

import fs from 'node:fs';
import { validatePdf, contentRoundtrip, referenceIntegrity } from './export-validate.mjs';
import { validateBrandContrast } from './brand-contrast.mjs';
import { captureRenderEvidence } from './render-evidence.mjs';
import { lintDocumentDiagrams } from './diagram-quality.mjs';
import { auditAccessibility } from './a11y-audit.mjs';

const RENDER_GATE_LEVELS = new Set(['render-smoke', 'full-certification', 'human-reviewed']);

// PDF and PPTX require external renderers; their absence at render-smoke+ is a hard failure.
const RENDER_REQUIRED_FORMATS = new Set(['pdf', 'pptx']);

// Detect invisible and hard-overlapping text in a produced HTML deliverable. The text roundtrip
// passes even when body text is invisible because hidden glyphs are still extractable; this gate
// catches opacity:0, matched foreground/background color, and hard-stacked absolute elements.

function markupVisualGate(exportPath, format) {
  if (format !== 'html') return { ok: true, issues: [], degradation: null };
  let html;
  try { html = fs.readFileSync(exportPath, 'utf8'); } catch { return { ok: true, issues: [], degradation: null }; }

  const issues = [];

  if (/\bopacity\s*:\s*0(?!\.\d)/i.test(html)) {
    issues.push('invisible-text: opacity:0 on element');
  }

  for (const m of html.matchAll(/style\s*=\s*["']([^"']*)["']/gi)) {
    const style = m[1];
    const fgM = style.match(/\bcolor\s*:\s*(#[0-9a-f]{3,6}|[a-z]+)/i);
    const bgM = style.match(/\bbackground(?:-color)?\s*:\s*(#[0-9a-f]{3,6}|[a-z]+)/i);
    if (fgM && bgM && fgM[1].toLowerCase() === bgM[1].toLowerCase()) {
      issues.push(`invisible-text: foreground and background both "${fgM[1].toLowerCase()}"`);
    }
  }

  const positions = new Map();
  for (const m of html.matchAll(/style\s*=\s*["']([^"']*)["']/gi)) {
    const style = m[1];
    if (!/position\s*:\s*absolute/i.test(style)) continue;
    const top = (style.match(/\btop\s*:\s*([^;,"'\s]+)/) || [])[1] ?? '';
    const left = (style.match(/\bleft\s*:\s*([^;,"'\s]+)/) || [])[1] ?? '';
    if (top === '' && left === '') continue;
    const key = `${top}|${left}`;
    const cnt = (positions.get(key) || 0) + 1;
    positions.set(key, cnt);
    if (cnt === 2) issues.push(`overlapping-text: elements stacked at top:${top} left:${left}`);
  }

  return { ok: issues.length === 0, issues, degradation: null };
}

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
  if (sourceMarkdown && baseDir) checks.references = referenceIntegrity(sourceMarkdown, baseDir, exportPath);
  if (format === 'html') checks.markup = markupVisualGate(exportPath, format);

  // Diagram legibility is advisory by default; `cx_diagram_quality: strict` escalates it.
  const diagrams = lintDocumentDiagrams(sourceMarkdown);

  // Per-format accessibility, with an honest checked-vs-uncheckable coverage report.
  const a11y = auditAccessibility({ format, exportPath, sourceMarkdown, env });

  // Palette contrast is a brand-system invariant, not a property of this document, so a
  // regression is surfaced as advisory rather than failing the user's publish.

  const contrast = validateBrandContrast();

  let render = null;
  if (RENDER_GATE_LEVELS.has(gateLevel)) {
    const renderFormat = renderFormatFor(format);
    if (renderFormat) render = captureRenderEvidence({ format: renderFormat, inputPath: exportPath, rootDir, env });
  }

  // A typed degradation (tool absent) never fails the publish; only a non-degraded,
  // document-scoped check whose ok is explicitly false does. Exception: at render-smoke+ gate
  // levels, a missing required renderer for pdf/pptx is a hard failure — the quality claim depends
  // on a tool that was never invoked.

  const failures = Object.entries(checks)
    .filter(([, result]) => result && result.ok === false && !result.degradation)
    .map(([name, result]) => `${name}: ${result.message || 'failed'}`);

  if (RENDER_GATE_LEVELS.has(gateLevel) && RENDER_REQUIRED_FORMATS.has(format) && render?.result?.degradation === 'missing-dependency') {
    failures.push(`render: required ${format} renderer absent at gate level '${gateLevel}'`);
  }

  if (diagramStrict && !diagrams.ok) {
    for (const w of diagrams.warnings) failures.push(`diagram ${w.diagram} (${w.kind}): ${w.code}`);
  }

  // Accessibility is advisory at standard levels and escalates at full-certification and above;
  // rendered-format limits stay in the uncheckable list, never a false pass.
  const a11yStrict = gateLevel === 'full-certification' || gateLevel === 'human-reviewed';
  if (a11yStrict) for (const f of a11y.failures || []) failures.push(`a11y ${f}`);

  return {
    ok: failures.length === 0,
    gateLevel,
    checks,
    contrast: { ok: contrast.ok, failures: contrast.failures },
    diagrams,
    a11y,
    render,
    failures,
  };
}
