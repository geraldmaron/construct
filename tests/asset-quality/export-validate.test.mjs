/**
 * tests/asset-quality/export-validate.test.mjs — Guards post-export validity checks.
 *
 * referenceIntegrity is pure and fully exercised; HTML content roundtrip needs no tools; PDF
 * validity and PDF/zip extraction run live where the tools exist and assert the typed-degradation
 * contract where they do not. No check ever reports a silent pass on missing tooling.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  validatePdf,
  contentRoundtrip,
  referenceIntegrity,
} from '../../lib/export-validate.mjs';
import { whichBin } from '../../lib/document-export.mjs';

const NO_TOOLING_ENV = { PATH: '/nonexistent-bin-dir' };

test('referenceIntegrity resolves local targets and flags the missing ones', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'refint-'));
  try {
    fs.writeFileSync(path.join(tmp, 'real.png'), 'x');
    const md = '![ok](real.png)\n![gone](missing.png)\n[here](real.png)\n[broken](nope.md)\n[ext](https://x.com)\n';
    const result = referenceIntegrity(md, tmp);
    assert.equal(result.ok, false);
    assert.deepEqual(result.missingImages, ['missing.png']);
    assert.deepEqual(result.brokenLinks, ['nope.md']);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('content roundtrip over HTML catches a dropped source heading', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'roundtrip-'));
  try {
    const html = path.join(tmp, 'out.html');
    fs.writeFileSync(html, '<html><body><h1>Doc</h1><h2>Problem</h2><h2>Goals</h2><p>body</p></body></html>');
    const source = '# Doc\n\n## Problem\n\np\n\n## Goals\n\np\n';
    assert.equal(contentRoundtrip({ exportPath: html, format: 'html', sourceMarkdown: source }).ok, true);

    const sourceWithExtra = source + '\n## Appendix\n\np\n';
    const result = contentRoundtrip({ exportPath: html, format: 'html', sourceMarkdown: sourceWithExtra });
    assert.equal(result.ok, false);
    assert.deepEqual(result.missingPhrases, ['Appendix']);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('content roundtrip degrades with a typed reason when the extractor is missing', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'roundtrip-deg-'));
  try {
    const fake = path.join(tmp, 'doc.pdf');
    fs.writeFileSync(fake, '%PDF-1.4 stub');
    const result = contentRoundtrip({ exportPath: fake, format: 'pdf', sourceMarkdown: '# x', env: NO_TOOLING_ENV });
    assert.equal(result.ok, false);
    assert.equal(result.degradation, 'missing-dependency');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('validatePdf parses a real export where pdfinfo exists, else degrades typed', () => {
  if (!whichBin('pdfinfo')) {
    assert.equal(validatePdf('/tmp/x.pdf', NO_TOOLING_ENV).degradation, 'missing-dependency');
    return;
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pdfval-'));
  try {
    const bad = path.join(tmp, 'bad.pdf');
    fs.writeFileSync(bad, 'not a pdf');
    const badResult = validatePdf(bad);
    assert.equal(badResult.valid, false);
    assert.equal(badResult.degradation, null);
    assert.equal(validatePdf('/tmp/x.pdf', NO_TOOLING_ENV).degradation, 'missing-dependency');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
