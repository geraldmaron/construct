/**
 * lib/a11y-audit.mjs — Per-format accessibility checks with an honest coverage report.
 *
 * Each export format declares the a11y checks that apply to it (contrast, alt text, heading
 * hierarchy, font floor, text extractability) and, just as importantly, the checks that are NOT
 * machine-verifiable for that format — rendered-text contrast in a PDF, reading order in a PPTX.
 * auditAccessibility runs the declared checks and returns both the results and the uncheckable
 * list, so the report never implies coverage it does not have. A missing tool degrades with a
 * typed reason rather than silently passing.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { validateBrandContrast } from './brand-contrast.mjs';
import { auditDeckMarkdownLayout } from './deck-export-pptx.mjs';
import { whichBin } from './document-export.mjs';

// Each format names the checks it runs and the a11y concerns that cannot be machine-verified for
// it, so the report distinguishes "checked and passed" from "not checkable here".

export const FORMAT_A11Y = Object.freeze({
  html: { checks: ['alt_text', 'heading_hierarchy', 'contrast'], uncheckable: [] },
  deck: { checks: ['alt_text', 'heading_hierarchy', 'contrast', 'font_floor'], uncheckable: [{ id: 'reading_order', reason: 'slide reading order is a visual-review judgment' }] },
  pptx: { checks: ['alt_text', 'font_floor'], uncheckable: [{ id: 'contrast', reason: 'rendered-text contrast needs OCR' }, { id: 'reading_order', reason: 'shape reading order is a visual-review judgment' }] },
  pdf: { checks: ['alt_text', 'text_extractable'], uncheckable: [{ id: 'contrast', reason: 'rendered-text contrast needs OCR' }, { id: 'tag_structure', reason: 'Typst/pandoc PDFs are untagged; structure is a manual check' }] },
  docx: { checks: ['alt_text'], uncheckable: [{ id: 'contrast', reason: 'theme contrast resolves in the office client' }] },
});

function altText(sourceMarkdown) {
  const body = String(sourceMarkdown || '').replace(/```[\s\S]*?```/g, '');
  const missing = [];
  for (const match of body.matchAll(/!\[([^\]]*)\]\(([^)]+)\)/g)) {
    if (!match[1].trim()) missing.push(match[2].split(/\s+/)[0]);
  }
  return missing.length === 0
    ? { id: 'alt_text', status: 'pass', detail: 'all images carry alt text' }
    : { id: 'alt_text', status: 'fail', detail: `images without alt text: ${missing.join(', ')}` };
}

// The branded templates supply the document h1 from the frontmatter title, so a source whose
// top section level is h2 is well-formed; a first heading of h3 or deeper, or any skipped level,
// is a real hierarchy break a screen reader cannot recover from.

function headingHierarchy(sourceMarkdown) {
  const body = String(sourceMarkdown || '').replace(/^---\n[\s\S]*?\n---\n/, '').replace(/```[\s\S]*?```/g, '');
  const levels = [...body.matchAll(/^(#{1,6})\s+\S/gm)].map((m) => m[1].length);
  if (levels.length === 0) return { id: 'heading_hierarchy', status: 'pass', detail: 'no headings' };
  if (levels[0] > 2) return { id: 'heading_hierarchy', status: 'fail', detail: `first heading is h${levels[0]}; sections should start at h1 or h2` };
  for (let i = 1; i < levels.length; i += 1) {
    if (levels[i] - levels[i - 1] > 1) return { id: 'heading_hierarchy', status: 'fail', detail: `heading jumps from h${levels[i - 1]} to h${levels[i]}` };
  }
  return { id: 'heading_hierarchy', status: 'pass', detail: 'headings start at the top level and never skip' };
}

function contrast() {
  const result = validateBrandContrast();
  return result.ok
    ? { id: 'contrast', status: 'pass', detail: 'brand text palette meets WCAG AA' }
    : { id: 'contrast', status: 'fail', detail: `${result.failures.length} brand pair(s) below AA` };
}

function fontFloor(sourceMarkdown) {
  const audit = auditDeckMarkdownLayout(sourceMarkdown, {});
  const below = audit.issues.filter((i) => i.code === 'font_below_floor');
  return below.length === 0
    ? { id: 'font_floor', status: 'pass', detail: 'no slide implies a sub-floor font' }
    : { id: 'font_floor', status: 'fail', detail: below.map((i) => `slide ${i.slide}`).join(', ') };
}

function textExtractable(exportPath, env) {
  if (!whichBin('pdftotext', env)) return { id: 'text_extractable', status: 'degraded', degradation: 'missing-dependency', detail: 'pdftotext not available' };
  if (!exportPath || !fs.existsSync(exportPath)) return { id: 'text_extractable', status: 'degraded', degradation: 'skipped-by-policy', detail: 'export not found' };
  const result = spawnSync('pdftotext', [exportPath, '-'], { encoding: 'utf8', env });
  const text = result.status === 0 ? (result.stdout || '').replace(/\s+/g, '') : '';
  return text.length > 20
    ? { id: 'text_extractable', status: 'pass', detail: 'PDF carries a real text layer (not image-only)' }
    : { id: 'text_extractable', status: 'fail', detail: 'PDF has little or no extractable text — likely image-only' };
}

export function auditAccessibility({ format, exportPath = null, sourceMarkdown = '', env = process.env } = {}) {
  const spec = FORMAT_A11Y[format];
  if (!spec) return { format, ok: true, results: [], coverage: { checked: [], uncheckable: [] }, unsupported: true };

  const results = [];
  for (const id of spec.checks) {
    if (id === 'alt_text') results.push(altText(sourceMarkdown));
    else if (id === 'heading_hierarchy') results.push(headingHierarchy(sourceMarkdown));
    else if (id === 'contrast') results.push(contrast());
    else if (id === 'font_floor') results.push(fontFloor(sourceMarkdown));
    else if (id === 'text_extractable') results.push(textExtractable(exportPath, env));
  }

  const failures = results.filter((r) => r.status === 'fail');
  return {
    format,
    ok: failures.length === 0,
    results,
    failures: failures.map((r) => `${r.id}: ${r.detail}`),
    coverage: {
      checked: results.map((r) => ({ id: r.id, status: r.status })),
      uncheckable: spec.uncheckable,
    },
  };
}
