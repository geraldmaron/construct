/**
 * tests/functional/rich-document-export.functional.test.mjs — RichDocument (ADR-0071) export
 * adapters + per-format validation contract (construct-d1r7.9).
 *
 * Exercises the real adapter against a rich fixture document. Engine-backed formats bind to
 * external binaries discovered at runtime (Pandoc/Typst/LibreOffice/pptxgenjs) and never bundled
 * (ADR-0001), so the per-format assertion is the contract, not a fixed pass: an export either
 * writes a real non-empty file whose matching validator passes, OR returns an actionable
 * diagnostic naming the missing engine — it never claims a spurious pass. Engine-free targets
 * (htmlfrag copy target, md/mdx, the markdown writer, shape validation, missing-engine diagnostics)
 * are asserted deterministically on any runner.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  makeRichDocument, makeSection, makeHeadingBlock, makeParagraphBlock, makeRun,
  makeListBlock, makeTableBlock, makeCell, makeFigureBlock, makeMediaRef, makeCodeBlock, makeCalloutBlock,
} from '../../lib/rich-document.mjs';
import { exportRichDocument, richDocumentToMarkdown, RICH_EXPORT_FORMATS } from '../../lib/rich-document-export.mjs';
import { validatePdf, validateArchive, validateHtml } from '../../lib/export-validate.mjs';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const tmpDirs = [];
after(() => { for (const dir of tmpDirs) rmTmpDir(dir); });

function tmpDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rich-export-'));
  tmpDirs.push(dir);
  return dir;
}

function richFixture() {
  return makeRichDocument(
    { title: 'Adapter Fixture', subtitle: 'Rich elements', artifactType: 'prd', docId: 'CX-FIX', authors: ['Ada Lovelace'], dates: { date: '2026-07-08' } },
    [
      makeSection({ id: 'introduction', level: 1, title: 'Introduction', blocks: [
        makeHeadingBlock({ level: 1, runs: [makeRun({ text: 'Introduction' })] }),
        makeParagraphBlock({ runs: [makeRun({ text: 'Hello ' }), makeRun({ text: 'bold', marks: ['bold'] }), makeRun({ text: ' and a ' }), makeRun({ text: 'link', marks: ['link'], href: 'https://example.com' })] }),
        makeListBlock({ style: 'bullet', items: [[makeParagraphBlock({ runs: [makeRun({ text: 'first' })] })], [makeParagraphBlock({ runs: [makeRun({ text: 'second' })] })]] }),
        makeTableBlock({ headers: [makeCell({ runs: [makeRun({ text: 'Feature' })] }), makeCell({ runs: [makeRun({ text: 'Status' })] })], rows: [[makeCell({ runs: [makeRun({ text: 'Export' })], colspan: 2 })]] }),
        makeCalloutBlock({ kind: 'note', blocks: [makeParagraphBlock({ runs: [makeRun({ text: 'A note callout' })] })] }),
        makeCodeBlock({ lang: 'js', text: 'const x = 1;' }),
      ] }),
      makeSection({ id: 'figures', level: 1, title: 'Figures', blocks: [
        makeHeadingBlock({ level: 1, runs: [makeRun({ text: 'Figures' })] }),
        makeFigureBlock({ media: makeMediaRef({ kind: 'image', uri: 'https://example.com/x.png', mimeType: 'image/png' }), caption: [makeRun({ text: 'A caption' })], altText: 'alt text here' }),
      ] }),
    ],
  );
}

function validateExport(format, target) {
  if (format === 'pdf') return validatePdf(target);
  if (['docx', 'pptx', 'odt', 'odp', 'epub'].includes(format)) return validateArchive(target, format);
  if (format === 'html' || format === 'htmlfrag') return validateHtml(target);
  return { ok: true };
}

test('every RichDocument format either exports+validates or returns an actionable diagnostic', () => {
  const doc = richFixture();
  const dir = tmpDir();
  for (const format of RICH_EXPORT_FORMATS) {
    const target = path.join(dir, `out.${format}`);
    const result = exportRichDocument({ doc, format, outputPath: target });
    if (result.ok) {
      assert.equal(fs.existsSync(target), true, `${format}: export reported ok but wrote no file`);
      assert.ok(fs.statSync(target).size > 0, `${format}: export wrote an empty file`);
      const validation = validateExport(format, target);
      const acceptable = validation.ok || validation.degradation === 'missing-dependency';
      assert.ok(acceptable, `${format}: validator rejected a produced file: ${validation.message}`);
    } else {
      assert.ok(result.message && /install|missing|unsupported|invalid/i.test(result.message), `${format}: failure lacked an actionable message: ${result.message}`);
    }
  }
});

test('htmlfrag copy target preserves rich elements a markdown fragment would flatten', () => {
  const dir = tmpDir();
  const target = path.join(dir, 'fragment.html');
  const result = exportRichDocument({ doc: richFixture(), format: 'htmlfrag', outputPath: target });
  assert.equal(result.ok, true, result.message);
  const frag = fs.readFileSync(target, 'utf8');
  assert.match(frag, /colspan="2"/, 'merged table cell lost');
  assert.match(frag, /<figure/, 'figure element lost');
  assert.match(frag, /<figcaption/, 'figure caption lost');
  assert.match(frag, /cx-callout/, 'callout lost');
  assert.match(frag, /alt="alt text here"/, 'figure alt text lost');
});

test('missing engine returns an actionable diagnostic and never a spurious pass', () => {
  const dir = tmpDir();
  const target = path.join(dir, 'noengine.pdf');
  const result = exportRichDocument({ doc: richFixture(), format: 'pdf', outputPath: target, env: { ...process.env, PATH: '' } });
  assert.equal(result.ok, false);
  assert.ok(Array.isArray(result.missing) && result.missing.length > 0, 'missing engines were not surfaced');
  assert.match(result.message, /install/i);
  assert.equal(fs.existsSync(target), false, 'a failed export must not leave an output file');
});

test('markdown writer round-trips headings, marks, lists, and a figure', () => {
  const md = richDocumentToMarkdown(richFixture());
  assert.match(md, /^# Introduction$/m);
  assert.match(md, /\*\*bold\*\*/);
  assert.match(md, /\[link\]\(https:\/\/example\.com\)/);
  assert.match(md, /^- first$/m);
  assert.match(md, /!\[alt text here\]\(https:\/\/example\.com\/x\.png/);
  assert.doesNotMatch(md, /^ {2,}#/m, 'no block should be spuriously indented');
});

test('an invalid RichDocument is rejected before any engine runs', () => {
  const result = exportRichDocument({ doc: { metadata: {}, sections: 'nope' }, format: 'md', outputPath: path.join(tmpDir(), 'x.md') });
  assert.equal(result.ok, false);
  assert.match(result.message, /invalid/i);
});
