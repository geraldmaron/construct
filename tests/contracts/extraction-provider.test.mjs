/**
 * tests/contracts/extraction-provider.test.mjs — schema-validation fixtures for
 * the extraction provider and extraction result contracts (construct-tsyfe.2.1).
 *
 * Covers the bead's acceptance criteria: both schema files parse as JSON with
 * no error, a known-good fixture validates with zero errors against
 * lib/contracts/extraction-provider.mjs, and known-bad fixtures (a missing
 * required field, a false losslessWhereAvailable with no reason, and a
 * malformed richDocument) each fail with an error naming the offending field.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  EXTRACTION_PROVIDER_SCHEMA,
  EXTRACTION_RESULT_SCHEMA,
  validateExtractionProvider,
  validateExtractionResult,
} from '../../lib/contracts/extraction-provider.mjs';
import { makeRichDocument, makeSection, makeParagraphBlock, makeRun } from '../../lib/rich-document.mjs';

const ROOT_DIR = path.resolve(import.meta.dirname, '..', '..');
const PROVIDER_SCHEMA_PATH = path.join(ROOT_DIR, 'schemas', 'extraction-provider.schema.json');
const RESULT_SCHEMA_PATH = path.join(ROOT_DIR, 'schemas', 'extraction-result.schema.json');

function goodProvider() {
  return {
    name: 'docling-sidecar',
    version: '2.4.1',
    configFingerprint: 'ocr=auto;model=v2',
    losslessWhereAvailable: true,
    supportsRichDocument: true,
  };
}

function goodRichDocument() {
  return makeRichDocument(
    { title: 'Fixture Document', artifactType: 'note' },
    [makeSection({ id: 'section-1', title: 'Intro', blocks: [makeParagraphBlock({ runs: [makeRun({ text: 'hello world' })] })] })],
  );
}

function goodResult() {
  return {
    provider: { name: 'docling-sidecar', version: '2.4.1', configFingerprint: 'ocr=auto;model=v2' },
    extractionMethod: 'docling-sidecar',
    text: 'hello world',
    characters: 11,
    truncated: false,
    losslessWhereAvailable: true,
    losslessReason: null,
    richDocument: goodRichDocument(),
    pageRefs: [{ page: 1, sectionIds: ['section-1'] }],
    layoutRefs: [{ id: 'layout-1', kind: 'region', page: 1, bbox: [0, 0, 100, 100] }],
    tables: [],
    figures: [],
    assets: [],
    droppedInfo: [],
    qualityReport: { textDensityPerPage: 812, lowTextYield: false, ocrConfidence: null, signals: {} },
    sourceGrounding: { granularity: 'page', refs: [{ sectionId: 'section-1', page: 1, offsetStart: null, offsetEnd: null }] },
  };
}

describe('schemas/extraction-provider.schema.json', () => {
  it('parses as JSON with no error', () => {
    assert.doesNotThrow(() => JSON.parse(fs.readFileSync(PROVIDER_SCHEMA_PATH, 'utf8')));
    assert.equal(EXTRACTION_PROVIDER_SCHEMA.title, 'Construct Extraction Provider Identity');
  });

  it('accepts a known-good provider fixture with zero errors', () => {
    const { valid, errors } = validateExtractionProvider(goodProvider());
    assert.equal(valid, true, `unexpected errors: ${errors.join('; ')}`);
    assert.deepEqual(errors, []);
  });

  it('rejects a fixture missing losslessWhereAvailable, naming the field', () => {
    const bad = goodProvider();
    delete bad.losslessWhereAvailable;
    const { valid, errors } = validateExtractionProvider(bad);
    assert.equal(valid, false);
    assert.ok(errors.some((e) => e.includes('losslessWhereAvailable')), `errors did not name the field: ${errors.join('; ')}`);
  });

  it('rejects a non-object record', () => {
    const { valid, errors } = validateExtractionProvider('not-an-object');
    assert.equal(valid, false);
    assert.ok(errors.length > 0);
  });
});

describe('schemas/extraction-result.schema.json', () => {
  it('parses as JSON with no error', () => {
    assert.doesNotThrow(() => JSON.parse(fs.readFileSync(RESULT_SCHEMA_PATH, 'utf8')));
    assert.equal(EXTRACTION_RESULT_SCHEMA.title, 'Construct Extraction Result');
  });

  it('accepts a known-good result fixture with zero errors', () => {
    const { valid, errors } = validateExtractionResult(goodResult());
    assert.equal(valid, true, `unexpected errors: ${errors.join('; ')}`);
    assert.deepEqual(errors, []);
  });

  it('rejects a fixture missing droppedInfo, naming the field', () => {
    const bad = goodResult();
    delete bad.droppedInfo;
    const { valid, errors } = validateExtractionResult(bad);
    assert.equal(valid, false);
    assert.ok(errors.some((e) => e.includes('droppedInfo')), `errors did not name the field: ${errors.join('; ')}`);
  });

  it('rejects a droppedInfo entry missing recoverable, naming the field', () => {
    const bad = goodResult();
    bad.droppedInfo = [{ kind: 'scanned-pdf', count: 1, reason: 'OCR fallback used' }];
    const { valid, errors } = validateExtractionResult(bad);
    assert.equal(valid, false);
    assert.ok(errors.some((e) => e.includes('recoverable')), `errors did not name the field: ${errors.join('; ')}`);
  });

  it('rejects losslessWhereAvailable=false with no losslessReason', () => {
    const bad = goodResult();
    bad.losslessWhereAvailable = false;
    bad.losslessReason = null;
    const { valid, errors } = validateExtractionResult(bad);
    assert.equal(valid, false);
    assert.ok(errors.some((e) => e.includes('losslessReason')), `errors did not name the field: ${errors.join('; ')}`);
  });

  it('accepts losslessWhereAvailable=false when a losslessReason is given', () => {
    const doc = goodResult();
    doc.losslessWhereAvailable = false;
    doc.losslessReason = 'source PDF was scanned; OCR text has no layout geometry';
    const { valid, errors } = validateExtractionResult(doc);
    assert.equal(valid, true, `unexpected errors: ${errors.join('; ')}`);
  });

  it('delegates richDocument shape errors to lib/rich-document.mjs validateRichDocument', () => {
    const bad = goodResult();
    bad.richDocument = { metadata: {}, sections: [{ id: 's1', blocks: [{ type: 'not-a-real-block-type' }] }] };
    const { valid, errors } = validateExtractionResult(bad);
    assert.equal(valid, false);
    assert.ok(errors.some((e) => e.includes('richDocument') && e.includes('not-a-real-block-type')), `errors: ${errors.join('; ')}`);
  });
});
