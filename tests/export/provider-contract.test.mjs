/**
 * tests/export/provider-contract.test.mjs — ExportProvider contract shape (construct-tsyfe.6.1).
 *
 * Proves the contract round trip end to end: a fixture RichDocument (lib/rich-document.mjs
 * builders) run through a stub provider that conforms to the contract validates clean, a result
 * missing any required field fails validation naming that field, and the module stays hand-rolled
 * (no Ajv/zod) per ADR-0001.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  makeRichDocument, makeSection, makeHeadingBlock, makeParagraphBlock, makeRun,
  makeTableBlock, makeCell, makeFigureBlock, makeMediaRef,
} from '../../lib/rich-document.mjs';
import {
  validateExportProviderResult,
  validateExportProviderCapabilities,
  computeFidelityReport,
  hashExportOutput,
} from '../../lib/export-provider-contract.mjs';

function fixtureDoc() {
  return makeRichDocument(
    { title: 'Contract Fixture', artifactType: 'note', docId: 'CX-CONTRACT-FIXTURE' },
    [
      makeSection({ id: 'overview', level: 1, title: 'Overview', blocks: [
        makeHeadingBlock({ level: 1, runs: [makeRun({ text: 'Overview' })] }),
        makeParagraphBlock({ runs: [makeRun({ text: 'A fixture document for the export provider contract.' })] }),
        makeTableBlock({
          headers: [makeCell({ runs: [makeRun({ text: 'Format' })] })],
          rows: [[makeCell({ runs: [makeRun({ text: 'stub' })] })]],
        }),
        makeFigureBlock({
          media: makeMediaRef({ kind: 'image', uri: 'photo.png', mimeType: 'image/png' }),
          caption: [makeRun({ text: 'A figure the stub provider cannot render' })],
          altText: 'a fixture figure',
        }),
      ] }),
    ],
  );
}

// A stub provider stands in for a real exporter (pptxgenjs, pandoc, ...): it declares which
// RichDocument block types it renders vs. drops for one format, "writes" deterministic bytes
// instead of really exporting, and reports the contract-shaped result.

const STUB_CAPABILITIES = {
  name: 'stub-pptx',
  version: '1.0.0-stub',
  formats: {
    pptx: { supports: ['heading', 'paragraph', 'table'], drops: ['figure'] },
  },
};

function runStubProvider({ doc, format, outputPath }) {
  fs.writeFileSync(outputPath, 'stub export bytes\n', 'utf8');
  const fidelity = computeFidelityReport({ doc, capabilities: STUB_CAPABILITIES, format });
  return {
    ok: true,
    format,
    outputPath,
    provider: { name: STUB_CAPABILITIES.name, version: STUB_CAPABILITIES.version },
    contentHash: hashExportOutput(outputPath),
    fidelity,
    message: `stub export of ${format}`,
  };
}

test('a fixture RichDocument run through a conforming stub provider validates clean', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-export-provider-contract-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const doc = fixtureDoc();
  const capCheck = validateExportProviderCapabilities(STUB_CAPABILITIES);
  assert.equal(capCheck.valid, true, capCheck.errors.join('; '));

  const result = runStubProvider({ doc, format: 'pptx', outputPath: path.join(dir, 'out.pptx') });

  assert.deepEqual(result.fidelity.droppedBlocks.map((d) => d.blockType), ['figure']);
  assert.equal(result.fidelity.droppedBlocks[0].count, 1);
  assert.equal(result.fidelity.degraded, true);
  assert.match(result.contentHash, /^sha256:[a-f0-9]{64}$/);

  const shapeCheck = validateExportProviderResult(result);
  assert.equal(shapeCheck.valid, true, shapeCheck.errors.join('; '));
  assert.deepEqual(shapeCheck.errors, []);
});

test('hashExportOutput is deterministic over the same bytes and independent of the file path', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-export-provider-contract-'));
  try {
    const pathA = path.join(dir, 'a.bin');
    const pathB = path.join(dir, 'nested', 'b.bin');
    fs.mkdirSync(path.dirname(pathB), { recursive: true });
    fs.writeFileSync(pathA, 'identical bytes', 'utf8');
    fs.writeFileSync(pathB, 'identical bytes', 'utf8');
    assert.equal(hashExportOutput(pathA), hashExportOutput(pathB));
    assert.equal(hashExportOutput(Buffer.from('identical bytes')), hashExportOutput(pathA));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a provider result missing a required field fails validation, naming the field', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-export-provider-contract-'));
  try {
    const doc = fixtureDoc();
    const base = runStubProvider({ doc, format: 'pptx', outputPath: path.join(dir, 'out.pptx') });

    const missingProviderVersion = { ...base, provider: { name: base.provider.name } };
    const r1 = validateExportProviderResult(missingProviderVersion);
    assert.equal(r1.valid, false);
    assert.ok(r1.errors.some((e) => e.includes('provider.version')), r1.errors.join('; '));

    const missingContentHash = { ...base, contentHash: undefined };
    const r2 = validateExportProviderResult(missingContentHash);
    assert.equal(r2.valid, false);
    assert.ok(r2.errors.some((e) => e.includes('contentHash')), r2.errors.join('; '));

    const malformedContentHash = { ...base, contentHash: 'not-a-real-hash' };
    const r3 = validateExportProviderResult(malformedContentHash);
    assert.equal(r3.valid, false);
    assert.ok(r3.errors.some((e) => e.includes('contentHash')), r3.errors.join('; '));

    const missingDroppedBlocks = { ...base, fidelity: { degraded: true } };
    const r4 = validateExportProviderResult(missingDroppedBlocks);
    assert.equal(r4.valid, false);
    assert.ok(r4.errors.some((e) => e.includes('fidelity.droppedBlocks')), r4.errors.join('; '));

    const inconsistentDegraded = { ...base, fidelity: { ...base.fidelity, degraded: false } };
    const r5 = validateExportProviderResult(inconsistentDegraded);
    assert.equal(r5.valid, false);
    assert.ok(r5.errors.some((e) => e.includes('fidelity.degraded')), r5.errors.join('; '));

    const missingOutputPath = { ...base, outputPath: undefined };
    const r6 = validateExportProviderResult(missingOutputPath);
    assert.equal(r6.valid, false);
    assert.ok(r6.errors.some((e) => e.includes('outputPath')), r6.errors.join('; '));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a capabilities declaration naming an unrecognized block type fails validation', () => {
  const bad = {
    name: 'stub-pptx',
    version: '1.0.0-stub',
    formats: { pptx: { supports: ['heading'], drops: ['not-a-real-block-type'] } },
  };
  const result = validateExportProviderCapabilities(bad);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('unrecognized block type')));
});

test('a capabilities declaration cannot mark the same block type both supported and dropped', () => {
  const bad = {
    name: 'stub-pptx',
    version: '1.0.0-stub',
    formats: { pptx: { supports: ['figure'], drops: ['figure'] } },
  };
  const result = validateExportProviderCapabilities(bad);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('both supported and dropped')));
});

test('the contract module is hand-rolled — no Ajv/zod dependency (ADR-0001)', () => {
  const modulePath = fileURLToPath(new URL('../../lib/export-provider-contract.mjs', import.meta.url));
  const source = fs.readFileSync(modulePath, 'utf8');
  assert.doesNotMatch(source, /\bajv\b/i);
  assert.doesNotMatch(source, /\bzod\b/i);
});
