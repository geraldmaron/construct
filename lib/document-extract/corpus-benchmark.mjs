/**
 * lib/document-extract/corpus-benchmark.mjs — benchmark unpdf/mammoth vs Docling on the extraction corpus.
 *
 * Loads tests/fixtures/document-extraction-corpus/manifest.json, runs lightweight
 * parsers per fixture, scores text fidelity against optional Docling output, and
 * emits routing-threshold recommendations consumed by extraction-ladder.mjs.
 */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { extractPdfWithUnpdf } from './providers/unpdf-provider.mjs';
import { extractDocxWithMammoth } from './providers/mammoth-provider.mjs';
import {
  isDigitalTextPdf,
  MIN_TEXT_DENSITY_CHARS_PER_PAGE,
  ROUTING_THRESHOLDS,
} from './routing-thresholds.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const CORPUS_DIR = join(REPO_ROOT, 'tests', 'fixtures', 'document-extraction-corpus');
export const CORPUS_MANIFEST_PATH = join(CORPUS_DIR, 'manifest.json');

function normalizeText(value) {
  return String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function tokenDiceSimilarity(a, b) {
  const left = new Set(normalizeText(a).split(/\s+/).filter(Boolean));
  const right = new Set(normalizeText(b).split(/\s+/).filter(Boolean));
  if (left.size === 0 && right.size === 0) return 1;
  if (left.size === 0 || right.size === 0) return 0;
  let overlap = 0;
  for (const token of left) {
    if (right.has(token)) overlap += 1;
  }
  return (2 * overlap) / (left.size + right.size);
}

function countTableMarkers(text) {
  const pipeRows = String(text || '').split('\n').filter((line) => /\|/.test(line)).length;
  const tabRows = String(text || '').split('\n').filter((line) => /\t/.test(line)).length;
  return pipeRows + tabRows;
}

export function loadCorpusManifest(manifestPath = CORPUS_MANIFEST_PATH) {
  const raw = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (!Array.isArray(raw.fixtures)) {
    throw new Error(`Invalid corpus manifest: missing fixtures[] at ${manifestPath}`);
  }
  return raw;
}

export function resolveCorpusFixturePath(fixture, corpusDir = CORPUS_DIR) {
  return join(corpusDir, fixture.file);
}

async function runLightweightParser(fixturePath, extension) {
  if (extension === '.pdf') {
    try {
      return await extractPdfWithUnpdf(fixturePath);
    } catch (err) {
      return { text: '', pageCount: 0, charsPerPage: 0, extractionMethod: 'unpdf', error: err.message, skipped: true };
    }
  }
  if (extension === '.docx') {
    try {
      return await extractDocxWithMammoth(fixturePath);
    } catch (err) {
      return { text: '', extractionMethod: 'mammoth', error: err.message, skipped: true };
    }
  }
  return { text: '', extractionMethod: 'unsupported', error: `unsupported extension ${extension}`, skipped: true };
}

export function decideRoutingTier(fixture, lightweight) {
  const extension = extname(fixture.file).toLowerCase();

  if (extension === '.pdf') {
    if (isDigitalTextPdf(lightweight)) {
      return {
        routingTier: 'lightweight-parser',
        provider: 'unpdf',
        reason: lightweight.pageCount === 1
          ? 'single-page PDF with non-empty unpdf text'
          : `text density ${Math.round(lightweight.charsPerPage)} chars/page >= ${MIN_TEXT_DENSITY_CHARS_PER_PAGE}`,
      };
    }
    return {
      routingTier: 'docling-local',
      provider: 'docling',
      reason: !String(lightweight.text || '').trim()
        ? 'unpdf returned empty text (scanned/image PDF)'
        : `text density ${Math.round(lightweight.charsPerPage || 0)} chars/page below ${MIN_TEXT_DENSITY_CHARS_PER_PAGE}`,
    };
  }

  if (extension === '.docx') {
    const text = String(lightweight.text || '').trim();
    if (!text) {
      return {
        routingTier: 'docling-local',
        provider: 'docling',
        reason: 'mammoth returned empty text',
      };
    }
    const signals = fixture.structureSignals || {};
    const needsLayout = Boolean(signals.hasTable || signals.hasEmbeddedImage);
    if (needsLayout) {
      return {
        routingTier: 'docling-local',
        provider: 'docling',
        reason: `high-fidelity DOCX with ${signals.hasTable ? 'table' : ''}${signals.hasTable && signals.hasEmbeddedImage ? ' and ' : ''}${signals.hasEmbeddedImage ? 'embedded image' : ''} structure`,
        lightweightTextAvailable: true,
      };
    }
    return {
      routingTier: 'lightweight-parser',
      provider: 'mammoth',
      reason: 'DOCX text extracted by mammoth with no layout-critical structure signals',
    };
  }

  return {
    routingTier: 'unsupported',
    provider: 'unsupported',
    reason: `no routing rule for ${extension}`,
  };
}

/**
 * @param {object} [opts]
 * @param {string} [opts.corpusDir]
 * @param {Function} [opts.doclingExtract]
 * @returns {Promise<{fixtures: object[], recommendations: object, thresholds: object}>}
 */
export async function runDocumentExtractionCorpusBenchmark({
  corpusDir = CORPUS_DIR,
  manifestPath = join(corpusDir, 'manifest.json'),
  doclingExtract = null,
} = {}) {
  const manifest = loadCorpusManifest(manifestPath);
  const rows = [];

  for (const fixture of manifest.fixtures) {
    const fixturePath = resolveCorpusFixturePath(fixture, corpusDir);
    if (!existsSync(fixturePath)) {
      throw new Error(`Missing corpus fixture: ${fixturePath}`);
    }

    const extension = extname(fixture.file).toLowerCase();
    const lightweight = await runLightweightParser(fixturePath, extension);
    const routing = lightweight.skipped
      ? {
        routingTier: 'skipped',
        provider: lightweight.extractionMethod,
        reason: lightweight.error || 'lightweight provider unavailable',
      }
      : decideRoutingTier(fixture, lightweight);

    let docling = null;
    if (typeof doclingExtract === 'function') {
      try {
        const out = await doclingExtract(fixturePath, fixture);
        docling = {
          text: out.text || out.markdown || '',
          extractionMethod: out.extractionMethod || 'docling',
        };
      } catch (err) {
        docling = { text: '', extractionMethod: 'docling', error: err.message };
      }
    }

    const lightweightText = lightweight.text || '';
    const doclingText = docling?.text || '';
    const fidelityVsDocling = docling
      ? tokenDiceSimilarity(lightweightText, doclingText)
      : null;

    rows.push({
      id: fixture.id,
      file: fixture.file,
      format: fixture.format,
      kind: fixture.kind,
      lightweightProvider: lightweight.extractionMethod,
      lightweightChars: lightweightText.length,
      lightweightTableMarkers: countTableMarkers(lightweightText),
      pageCount: lightweight.pageCount ?? null,
      charsPerPage: lightweight.charsPerPage ?? null,
      routingTier: routing.routingTier,
      routingProvider: routing.provider,
      routingReason: routing.reason,
      expectedRoutingTier: fixture.expectedRoutingTier,
      skipped: Boolean(lightweight.skipped),
      doclingAvailable: Boolean(docling),
      doclingChars: docling ? doclingText.length : null,
      fidelityVsDocling,
      matchesExpected: lightweight.skipped
        ? null
        : routing.routingTier === fixture.expectedRoutingTier,
    });
  }

  const recommendations = {
    pdf: {
      minCharsPerPageForLightweight: MIN_TEXT_DENSITY_CHARS_PER_PAGE,
      singlePageAlwaysLightweightIfNonEmpty: ROUTING_THRESHOLDS.pdf.singlePageAlwaysLightweightIfNonEmpty,
      rationale: `Digital PDFs with non-empty unpdf text on a single page route to unpdf. Multi-page PDFs require >= ${MIN_TEXT_DENSITY_CHARS_PER_PAGE} chars/page; lower density or empty unpdf yield escalates to Docling for scanned/image content.`,
    },
    docx: {
      preferLightweightWhenTextNonEmpty: true,
      escalateToDoclingWhenHighFidelityAnd: [...ROUTING_THRESHOLDS.docx.escalateToDoclingWhenHighFidelityAnd],
      rationale: 'Plain DOCX body text routes to mammoth. Fixtures with tables or embedded images should escalate to Docling when high fidelity is requested because mammoth flattens structure.',
    },
  };

  return {
    fixtures: rows,
    recommendations,
    thresholds: ROUTING_THRESHOLDS,
  };
}
