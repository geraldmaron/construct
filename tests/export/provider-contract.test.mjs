/**
 * tests/export/provider-contract.test.mjs — ExportProvider result contract (construct-tsyfe.6.1).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  validateExportProviderResult,
  validateExportProviderCapabilities,
  computeFidelityReport,
  hashExportOutput,
  attachExportEvidence,
  DEFAULT_EXPORT_CAPABILITIES,
} from '../../lib/export-provider-contract.mjs';
import {
  makeRichDocument, makeSection, makeParagraphBlock, makeRun, makeFigureBlock, makeMediaRef,
} from '../../lib/rich-document.mjs';

function tmpFile(content) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'export-contract-')), 'out.bin');
  fs.writeFileSync(file, content);
  return file;
}

function fixtureDoc() {
  return makeRichDocument({ title: 'Fixture' }, [
    makeSection({
      id: 'main',
      level: 1,
      title: 'Main',
      blocks: [
        makeParagraphBlock({ runs: [makeRun({ text: 'Hello' })] }),
        makeFigureBlock({
          media: makeMediaRef({ kind: 'image', uri: 'x.png', mimeType: 'image/png' }),
          altText: 'alt',
        }),
      ],
    }),
  ]);
}

function stubProviderResult(doc, format, target) {
  const base = attachExportEvidence({
    ok: true,
    format,
    outputPath: target,
    engine: 'copy',
    message: 'stub',
  }, {
    doc,
    format,
    resolveProvider: () => ({ name: 'construct', version: 'copy' }),
  });
  return base;
}

test('fixture RichDocument validates through the contract on txt export', () => {
  const doc = fixtureDoc();
  const target = tmpFile('hello');
  const result = stubProviderResult(doc, 'txt', target);
  const validation = validateExportProviderResult(result);
  assert.equal(validation.ok, true, validation.errors?.join('; '));
  assert.equal(result.fidelity.degraded, true);
  assert.equal(result.fidelity.droppedBlocks.some((entry) => entry.type === 'figure'), true);
  assert.match(result.contentHash, /^sha256:[a-f0-9]{64}$/);
});

test('hashExportOutput is deterministic for identical bytes', () => {
  const a = hashExportOutput(Buffer.from('same'));
  const b = hashExportOutput(Buffer.from('same'));
  const c = hashExportOutput(Buffer.from('different'));
  assert.equal(a, b);
  assert.notEqual(a, c);
});

test('validateExportProviderResult rejects missing required fields', () => {
  const cases = [
    { ok: true, format: 'md', outputPath: '/tmp/x', provider: { name: 'x' }, contentHash: 'sha256:' + 'a'.repeat(64), fidelity: { droppedBlocks: [], degraded: false } },
    { ok: true, format: 'md', outputPath: '/tmp/x', provider: { name: 'x', version: '1' }, contentHash: 'bad', fidelity: { droppedBlocks: [], degraded: false } },
    { ok: true, format: 'md', outputPath: '/tmp/x', provider: { name: 'x', version: '1' }, contentHash: 'sha256:' + 'a'.repeat(64), fidelity: { droppedBlocks: 'nope', degraded: false } },
    { ok: true, format: 'md', outputPath: '/tmp/x', provider: { name: 'x', version: '1' }, contentHash: 'sha256:' + 'a'.repeat(64), fidelity: { droppedBlocks: [{ type: 'x' }], degraded: false } },
    { ok: true, format: 'md', provider: { name: 'x', version: '1' }, contentHash: 'sha256:' + 'a'.repeat(64), fidelity: { droppedBlocks: [], degraded: false } },
    { ok: true, format: 'md', outputPath: '/tmp/x', contentHash: 'sha256:' + 'a'.repeat(64), fidelity: { droppedBlocks: [], degraded: false } },
  ];
  for (const result of cases) {
    assert.equal(validateExportProviderResult(result).ok, false);
  }
});

test('capabilities validator rejects overlap and unknown block types', () => {
  assert.equal(validateExportProviderCapabilities({ md: { supports: ['paragraph'], drops: ['paragraph'] } }).ok, false);
  assert.equal(validateExportProviderCapabilities({ md: { supports: ['not-a-block'], drops: [] } }).ok, false);
  assert.equal(validateExportProviderCapabilities(DEFAULT_EXPORT_CAPABILITIES).ok, true);
});

test('computeFidelityReport lists dropped block types present in the document', () => {
  const doc = makeRichDocument({ title: 'Callout doc' }, [
    makeSection({
      id: 's',
      level: 1,
      blocks: [
        {
          type: 'callout',
          kind: 'note',
          blocks: [makeParagraphBlock({ runs: [makeRun({ text: 'note' })] })],
        },
      ],
    }),
  ]);
  const report = computeFidelityReport({ doc, capabilities: DEFAULT_EXPORT_CAPABILITIES, format: 'md' });
  assert.equal(report.degraded, true);
  assert.equal(report.droppedBlocks.some((entry) => entry.type === 'callout'), true);
});

test('contract module stays hand-rolled without ajv or zod', () => {
  const source = fs.readFileSync(new URL('../../lib/export-provider-contract.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /ajv|zod/i);
});
