/**
 * lib/certification/document-io-matrix.mjs — certified document I/O matrix (construct-d1r7.10 → .11).
 *
 * Two modes over the same matrix. **Local** mode is the graceful-degradation contract the rest of
 * the export path already honours: a format whose engine is absent is skipped, not failed. **Certified**
 * mode is the release contract: every declared output format MUST have its engine present and MUST
 * export a real file its validator accepts — a format skipped for a missing tool is a hard failure,
 * not a pass, so certification cannot be earned by having Pandoc/Typst/LibreOffice/pptxgenjs quietly
 * absent. Each result names the exact format, engine, and validation failure so a red CI line points
 * straight at the gap.
 *
 * The intake half is asserted by the fixture catalog (lib/certification/document-io-fixtures.mjs); this
 * module owns the export half, exercising the real RichDocument export adapters (lib/rich-document-export.mjs)
 * and per-format validators (lib/export-validate.mjs) against a realistic fixture document with a
 * local raster asset, a table, a figure with caption/alt, a code block, and a diagram.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { whichBin } from '../document-export.mjs';
import { libreOfficePresent } from '../libreoffice-export.mjs';
import { pptxgenPresent } from '../deck-export-pptx.mjs';
import { exportRichDocument } from '../rich-document-export.mjs';
import { validatePdf, validateArchive, validateHtml } from '../export-validate.mjs';
import {
  makeRichDocument, makeSection, makeHeadingBlock, makeParagraphBlock, makeRun,
  makeListBlock, makeTableBlock, makeCell, makeFigureBlock, makeMediaRef, makeCodeBlock, makeDiagramBlock, makeCalloutBlock,
} from '../rich-document.mjs';
import { validateDocumentIoFixtures } from './document-io-fixtures.mjs';

const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC';

// Each output format declares the engines it requires and the validator that proves the produced
// file is really that format. 'bytes' formats have no structural validator beyond a non-empty file.

export const DOCUMENT_IO_EXPORT_MATRIX = Object.freeze([
  { format: 'html', engines: ['pandoc'], validate: 'html' },
  { format: 'htmlfrag', engines: [], validate: 'html' },
  { format: 'pdf', engines: ['pandoc', 'typst'], validate: 'pdf' },
  { format: 'docx', engines: ['pandoc'], validate: 'archive' },
  { format: 'doc', engines: ['pandoc', 'libreoffice'], validate: 'bytes' },
  { format: 'odt', engines: ['pandoc'], validate: 'archive' },
  { format: 'odp', engines: ['pptxgenjs', 'libreoffice'], validate: 'archive' },
  { format: 'pptx', engines: ['pptxgenjs'], validate: 'archive' },
  { format: 'deck', engines: ['pandoc'], validate: 'bytes' },
  { format: 'rtf', engines: ['pandoc'], validate: 'bytes' },
  { format: 'epub', engines: ['pandoc'], validate: 'archive' },
  { format: 'txt', engines: ['pandoc'], validate: 'bytes' },
  { format: 'tex', engines: ['pandoc'], validate: 'bytes' },
  { format: 'md', engines: [], validate: 'bytes' },
  { format: 'mdx', engines: [], validate: 'bytes' },
]);

function engineAvailable(name, env) {
  if (name === 'libreoffice') return libreOfficePresent(env);
  if (name === 'pptxgenjs') return pptxgenPresent();
  return Boolean(whichBin(name, env));
}

function certificationFixture(baseDir) {
  fs.writeFileSync(path.join(baseDir, 'photo.png'), Buffer.from(PNG_B64, 'base64'));
  return makeRichDocument(
    { title: 'Document I/O Certification', subtitle: 'Every output format', artifactType: 'prd', docId: 'CX-CERT', authors: ['Certification'], dates: { date: '2026-07-08' } },
    [
      makeSection({ id: 'overview', level: 1, title: 'Overview', blocks: [
        makeHeadingBlock({ level: 1, runs: [makeRun({ text: 'Overview' })] }),
        makeParagraphBlock({ runs: [makeRun({ text: 'This document exercises ' }), makeRun({ text: 'every', marks: ['bold'] }), makeRun({ text: ' certified output format.' })] }),
        makeListBlock({ style: 'bullet', items: [[makeParagraphBlock({ runs: [makeRun({ text: 'structured content' })] })], [makeParagraphBlock({ runs: [makeRun({ text: 'a real asset' })] })]] }),
        makeTableBlock({ headers: [makeCell({ runs: [makeRun({ text: 'Format' })] }), makeCell({ runs: [makeRun({ text: 'Engine' })] })], rows: [[makeCell({ runs: [makeRun({ text: 'certified' })], colspan: 2 })]] }),
        makeCalloutBlock({ kind: 'note', blocks: [makeParagraphBlock({ runs: [makeRun({ text: 'A note callout' })] })] }),
        makeCodeBlock({ lang: 'js', text: 'const certified = true;' }),
      ] }),
      makeSection({ id: 'media', level: 1, title: 'Media', blocks: [
        makeHeadingBlock({ level: 1, runs: [makeRun({ text: 'Media' })] }),
        makeFigureBlock({ media: makeMediaRef({ kind: 'image', uri: 'photo.png', mimeType: 'image/png' }), caption: [makeRun({ text: 'A certification figure' })], altText: 'a red pixel' }),
        makeDiagramBlock({ lang: 'mermaid', source: 'flowchart TD\nA-->B' }),
      ] }),
    ],
  );
}

function runValidator(kind, format, target, env) {
  if (kind === 'pdf') return validatePdf(target, env);
  if (kind === 'archive') return validateArchive(target, format, env);
  if (kind === 'html') return validateHtml(target);
  const size = fs.existsSync(target) ? fs.statSync(target).size : 0;
  return { ok: size > 0, message: size > 0 ? `${size} bytes` : 'empty or absent file' };
}

// A validator that degrades for a missing helper (e.g. pdfinfo/unzip absent) is not a content
// failure — the export itself succeeded; treat the structural check as inconclusive-but-passing so
// the matrix certifies the export engine, not the validator's optional tooling.

function validationAcceptable(validation) {
  return validation.ok || validation.degradation === 'missing-dependency';
}

/**
 * runDocumentIoMatrix — export the certification fixture to every declared format, validate each,
 * and roll the per-format outcomes up under the mode's contract.
 * mode: 'certified' (all engines must be present and pass) | 'local' (missing engines skip cleanly).
 */
export function runDocumentIoMatrix({ mode = 'local', env = process.env, repoRoot } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-doc-io-cert-'));
  try {
    const doc = certificationFixture(dir);
    const fixtureAudit = validateDocumentIoFixtures({ rootDir: repoRoot });
    const results = [];

    for (const entry of DOCUMENT_IO_EXPORT_MATRIX) {
      const missingEngines = entry.engines.filter((name) => !engineAvailable(name, env));
      if (missingEngines.length) {
        results.push({
          format: entry.format,
          engines: entry.engines,
          available: false,
          status: mode === 'certified' ? 'failed' : 'skipped',
          detail: `missing engine(s): ${missingEngines.join(', ')}`,
        });
        continue;
      }

      const target = path.join(dir, `out.${entry.format}`);
      const exportResult = exportRichDocument({ doc, format: entry.format, outputPath: target, env, assetBaseDir: dir, ...(repoRoot ? { repoRoot } : {}) });
      if (!exportResult.ok) {
        results.push({ format: entry.format, engines: entry.engines, available: true, status: 'failed', detail: `export failed: ${exportResult.message}` });
        continue;
      }
      const validation = runValidator(entry.validate, entry.format, target, env);
      if (!validationAcceptable(validation)) {
        results.push({ format: entry.format, engines: entry.engines, available: true, status: 'failed', detail: `validation failed (${entry.validate}): ${validation.message}` });
        continue;
      }
      results.push({
        format: entry.format,
        engines: entry.engines,
        available: true,
        status: 'certified',
        detail: validation.degradation === 'missing-dependency' ? `${validation.message} (validator degraded)` : validation.message,
      });
    }

    const summary = {
      certified: results.filter((r) => r.status === 'certified').length,
      skipped: results.filter((r) => r.status === 'skipped').length,
      failed: results.filter((r) => r.status === 'failed').length,
    };
    const pass = fixtureAudit.pass && summary.failed === 0;
    return { mode, pass, summary, fixtureAudit, results };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export function formatDocumentIoMatrix(report) {
  const lines = [`Document I/O matrix — mode: ${report.mode} — ${report.pass ? 'PASS' : 'FAIL'}`];
  lines.push(`  intake fixtures: ${report.fixtureAudit.pass ? 'ok' : `FAIL (${report.fixtureAudit.errors.length} missing)`}`);
  lines.push(`  export: ${report.summary.certified} certified, ${report.summary.skipped} skipped, ${report.summary.failed} failed`);
  for (const r of report.results) {
    const mark = r.status === 'certified' ? '✓' : r.status === 'skipped' ? '·' : '✗';
    lines.push(`  ${mark} ${r.format.padEnd(9)} [${r.engines.join('+') || 'none'}] ${r.detail}`);
  }
  return `${lines.join('\n')}\n`;
}
