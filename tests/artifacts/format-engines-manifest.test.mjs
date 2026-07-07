/**
 * tests/artifacts/format-engines-manifest.test.mjs — LMCP-B7: FORMAT_ENGINES
 * moved from a hardcoded dict to lib/registry/manifests/format-engines.default.json,
 * with `.construct/registry/format-engines.json` project-override support. Asserts the
 * default surface is byte-identical to the prior hardcoded dict, and that a
 * project override in a fixture project adds a format without editing source.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EXPORT_FORMATS, resolveFormatEngines, detect, exportMarkdown } from '../../lib/document-export.mjs';

const PRIOR_HARDCODED_FORMAT_ENGINES = {
  pdf: { engine: 'pandoc', writer: null, pdfEngine: 'typst', extraBinaries: ['typst'] },
  docx: { engine: 'pandoc', writer: null, pdfEngine: null, extraBinaries: [] },
  doc: { engine: 'pandoc', writer: null, pdfEngine: null, extraBinaries: [], via: 'libreoffice', intermediate: 'docx' },
  deck: { engine: 'pandoc', writer: null, pdfEngine: null, extraBinaries: [] },
  pptx: { engine: 'pptxgenjs', writer: null, pdfEngine: null, extraBinaries: [] },
  html: { engine: 'pandoc', writer: null, pdfEngine: null, extraBinaries: [] },
  rtf: { engine: 'pandoc', writer: 'rtf', pdfEngine: null, extraBinaries: [] },
  odt: { engine: 'pandoc', writer: 'odt', pdfEngine: null, extraBinaries: [] },
  epub: { engine: 'pandoc', writer: 'epub', pdfEngine: null, extraBinaries: [] },
  tex: { engine: 'pandoc', writer: 'latex', pdfEngine: null, extraBinaries: [] },
  txt: { engine: 'pandoc', writer: 'plain', pdfEngine: null, extraBinaries: [] },
  md: { engine: 'copy', writer: null, pdfEngine: null, extraBinaries: [] },
  mdx: { engine: 'copy', writer: null, pdfEngine: null, extraBinaries: [] },
};

function withFixtureProject(overrideJson, fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-format-engines-'));
  try {
    if (overrideJson) {
      const dir = path.join(root, '.construct', 'registry');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'format-engines.json'), JSON.stringify(overrideJson, null, 2));
    }
    return fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('EXPORT_FORMATS is byte-identical to the prior hardcoded key list', () => {
  assert.deepEqual(EXPORT_FORMATS, Object.keys(PRIOR_HARDCODED_FORMAT_ENGINES));
});

test('resolveFormatEngines with no project override is byte-identical to the prior hardcoded dict', () => {
  withFixtureProject(null, (root) => {
    assert.deepEqual(resolveFormatEngines({ cwd: root }), PRIOR_HARDCODED_FORMAT_ENGINES);
  });
});

test('detect() default behavior is unaffected by the manifest move (pdf format shape)', () => {
  withFixtureProject(null, (root) => {
    const emptyPathEnv = { ...process.env, PATH: fs.mkdtempSync(path.join(os.tmpdir(), 'cx-empty-path-')) };
    const result = detect('pdf', emptyPathEnv, { cwd: root });
    assert.equal(result.ok, true);
    assert.ok(result.missing.includes('pandoc'));
    assert.ok(result.missing.includes('typst'));
  });
});

test('a .construct/registry/format-engines.json override adds a new format without editing source', () => {
  withFixtureProject({
    json: { engine: 'copy', writer: null, pdfEngine: null, extraBinaries: [] },
  }, (root) => {
    const engines = resolveFormatEngines({ cwd: root });
    assert.ok(engines.json, 'expected the override-declared json format to be present');
    assert.deepEqual(engines.pdf, PRIOR_HARDCODED_FORMAT_ENGINES.pdf, 'default formats must survive an additive override');

    const inputPath = path.join(root, 'source.md');
    fs.writeFileSync(inputPath, '# Title\n\nBody text.\n');
    const result = exportMarkdown({ inputPath, format: 'json', cwd: root });
    assert.equal(result.ok, true, result.message);
    assert.ok(fs.existsSync(path.join(root, 'source.json')));
  });
});

test('a .construct/registry/format-engines.json override can replace a default format entry', () => {
  withFixtureProject({
    md: { engine: 'copy', writer: null, pdfEngine: null, extraBinaries: [], overridden: true },
  }, (root) => {
    const engines = resolveFormatEngines({ cwd: root });
    assert.equal(engines.md.overridden, true);
    assert.deepEqual(engines.docx, PRIOR_HARDCODED_FORMAT_ENGINES.docx, 'unrelated default formats must be untouched');
  });
});

test('exportMarkdown rejects a format unknown to both default and override', () => {
  withFixtureProject(null, (root) => {
    const inputPath = path.join(root, 'source.md');
    fs.writeFileSync(inputPath, '# Title\n');
    const result = exportMarkdown({ inputPath, format: 'nope', cwd: root });
    assert.equal(result.ok, false);
    assert.match(result.message, /Unsupported format: nope/);
  });
});
