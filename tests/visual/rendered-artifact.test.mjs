/**
 * tests/visual/rendered-artifact.test.mjs — real rendered-artifact visual gate (LMCP-L5).
 *
 * Replaces the former `test:visual` script, which printed a static string and exited 0 without
 * running anything. This suite exports the golden PRD/deck fixtures through the real document
 * engines (Pandoc + Typst for PDF, Pandoc for DOCX, Pandoc + pptxgenjs + LibreOffice for PPTX
 * rasterization), asserts every rasterized page of a render-required format carries real ink (not
 * a blank canvas from a broken template or missing font), and reuses runOutputQuality's
 * text-extraction-parity and reference-integrity checks against the produced file. A required
 * engine that is absent is a hard test failure with a clear, CI-visible reason — never a silent
 * pass or skip — per LMCP-L5 acceptance. On a host without LibreOffice the PPTX test fails loudly
 * for exactly this reason; that failure is the gate working as designed, not a defect in it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

import { checkRenderedArtifact, inkRatio } from '../../lib/render-visual-check.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PRD_FIXTURE = path.join(REPO, 'tests', 'fixtures', 'publish', 'golden-prd-platform.md');

// The shared golden-deck-platform.md fixture (tests/fixtures/publish/) carries a docs-root-relative
// link (/reference/document-io) that legitimately fails on-disk reference-integrity when resolved
// against the fixture's own directory, exactly as it would in production publish.mjs. That is a
// pre-existing property of a fixture shared with export-format-cert.test.mjs and deck-export-pptx.
// test.mjs, neither of which exercises reference-integrity, so this suite uses its own
// self-contained deck fixture with no filesystem-ambiguous links instead of quietly editing shared
// fixture content to make this new gate pass.

const DECK_FIXTURE = path.join(REPO, 'tests', 'visual', 'fixtures', 'deck-self-contained.md');

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function assertPass(result) {
  assert.equal(
    result.ok,
    true,
    `${result.format} rendered-artifact gate failed: ${result.message}`,
  );
}

// Minimal hand-built 8-bit RGB PNG (uncompressed filter-none scanlines fed through deflate) so
// inkRatio's zlib-inflate + filter-reconstruction path has hermetic, ground-truth coverage that
// does not depend on pdftoppm/soffice being installed.

function crc32(buf) {
  const table = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? (0xedb88320 ^ (c >>> 1)) : c >>> 1;
    table[n] = c;
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function buildPng({ width, height, blackPixels = [] }) {
  const channels = 3;
  const stride = width * channels;
  const raw = Buffer.alloc(height * (1 + stride), 255);
  for (let y = 0; y < height; y++) raw[y * (1 + stride)] = 0;
  for (const [x, y] of blackPixels) {
    const rowStart = y * (1 + stride) + 1 + x * channels;
    raw[rowStart] = 0;
    raw[rowStart + 1] = 0;
    raw[rowStart + 2] = 0;
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8);
  ihdr.writeUInt8(2, 9);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

test('inkRatio reports 0 for an all-white PNG and a real ratio for one with ink', () => {
  const dir = tmpDir('cx-visual-pngunit-');
  try {
    const blank = path.join(dir, 'blank.png');
    fs.writeFileSync(blank, buildPng({ width: 10, height: 10, blackPixels: [] }));
    assert.equal(inkRatio(blank), 0);

    const inked = path.join(dir, 'inked.png');
    fs.writeFileSync(inked, buildPng({ width: 10, height: 10, blackPixels: [[5, 5]] }));
    assert.equal(inkRatio(inked), 0.01);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('PDF export renders non-blank pages with text parity and reference integrity intact', () => {
  const dir = tmpDir('cx-visual-pdf-');
  try {
    const result = checkRenderedArtifact({ fixturePath: PRD_FIXTURE, format: 'pdf', workDir: dir });
    assertPass(result);
    assert.ok(result.pageCount > 0, 'expected at least one rendered page');
    assert.ok(result.inkRatios.every((r) => r > 0), 'expected every page to carry visible ink');
    assert.equal(result.quality.checks.pdf.ok, true, JSON.stringify(result.quality.checks.pdf));
    assert.equal(result.quality.checks.roundtrip.ok, true, JSON.stringify(result.quality.checks.roundtrip.missingPhrases));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('DOCX export passes text parity and reference integrity (no raster path upstream)', () => {
  const dir = tmpDir('cx-visual-docx-');
  try {
    const result = checkRenderedArtifact({ fixturePath: PRD_FIXTURE, format: 'docx', workDir: dir });
    assertPass(result);
    assert.equal(result.quality.checks.roundtrip.ok, true, JSON.stringify(result.quality.checks.roundtrip.missingPhrases));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('PPTX export renders non-blank slides with text parity intact', () => {
  const dir = tmpDir('cx-visual-pptx-');
  try {
    const result = checkRenderedArtifact({ fixturePath: DECK_FIXTURE, format: 'pptx', workDir: dir });
    assertPass(result);
    assert.ok(result.pageCount > 0, 'expected at least one rasterized slide');
    assert.ok(result.inkRatios.every((r) => r > 0), 'expected every slide to carry visible ink');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a missing required engine is a typed hard failure, never a silent skip', () => {
  const dir = tmpDir('cx-visual-no-engine-');
  try {
    const result = checkRenderedArtifact({
      fixturePath: PRD_FIXTURE,
      format: 'pdf',
      workDir: dir,
      env: { PATH: tmpDir('cx-visual-empty-path-') },
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'missing-dependency');
    assert.match(result.message, /requires real engines/);
    assert.doesNotMatch(result.message, /silent(ly)? skip/i);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a produced PDF referencing a missing local image fails the reference-integrity check', () => {
  const dir = tmpDir('cx-visual-badref-');
  try {
    const src = [
      '# Doc',
      '',
      '## Problem',
      '',
      '![missing](./does-not-exist.png)',
      '',
      'Body paragraph with enough text to render a real page.',
      '',
    ].join('\n');
    const fixture = path.join(dir, 'bad-ref.md');
    fs.writeFileSync(fixture, src, 'utf8');
    const result = checkRenderedArtifact({ fixturePath: fixture, format: 'pdf', workDir: dir });
    assert.equal(result.ok, false, 'expected the missing local reference to fail the gate');
    // Two valid failure paths reach the same correct outcome, depending on the
    // installed typst/pandoc version: an older combo lets export succeed with a
    // dangling reference, caught by a post-hoc reference-integrity scan
    // (message mentions "references"); a newer typst hard-fails at PDF-compile
    // time because it can't find the image file at all (message names the
    // missing filename directly, e.g. "file not found ... does-not-exist.png").
    // Either is the gate correctly rejecting the broken doc — assert on the
    // one thing invariant across both: the missing filename itself.
    assert.ok(
      result.failures.some((f) => /references/.test(f) || f.includes('does-not-exist.png')),
      JSON.stringify(result.failures),
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
