/**
 * lib/document-extract/docling-serve-parity.mjs — Docling Serve vs local sidecar parity certification.
 *
 * Hermetic parity checks over the document-extraction corpus using injectable
 * local and remote extractors (construct-tsyfe.2.5). Compares markdown fidelity
 * and validates both outputs against the Wave-1 extraction provider contract.
 */

import { readFileSync } from 'node:fs';
import { extname, join } from 'node:path';

import {
  CORPUS_DIR,
  loadCorpusManifest,
  resolveCorpusFixturePath,
} from './corpus-benchmark.mjs';
import { validateExtractionProviderResult } from './extraction-result-contract.mjs';

export const DEFAULT_PARITY_TOLERANCE = 0.85;

function normalizeText(value) {
  return String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function tokenDiceSimilarity(a, b) {
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

function sidecarShapeFromRemote(remoteResult, fixturePath) {
  return {
    text: remoteResult.text,
    markdown: remoteResult.text,
    extractionMethod: 'docling',
    characters: remoteResult.characters,
    truncated: remoteResult.truncated,
    droppedInfo: remoteResult.droppedInfo ?? [],
    metadata: { sourcePath: fixturePath },
  };
}

/**
 * @param {object} [opts]
 * @param {Function} opts.localExtract async (fixturePath) => sidecar-shaped result
 * @param {Function} opts.remoteExtract async ({ filePath, env }) => remote extractor result
 * @param {number} [opts.tolerance]
 * @param {string} [opts.corpusDir]
 * @returns {Promise<{ pass: boolean, fixtures: object[], errors: string[] }>}
 */
export async function runDoclingServeParityCertification({
  localExtract,
  remoteExtract,
  tolerance = DEFAULT_PARITY_TOLERANCE,
  corpusDir = CORPUS_DIR,
  env = {},
} = {}) {
  if (typeof localExtract !== 'function' || typeof remoteExtract !== 'function') {
    throw new Error('localExtract and remoteExtract are required');
  }

  const manifest = loadCorpusManifest(join(corpusDir, 'manifest.json'));
  const fixtures = [];
  const errors = [];

  for (const fixture of manifest.fixtures) {
    const fixturePath = resolveCorpusFixturePath(fixture, corpusDir);
    const extension = extname(fixture.file).toLowerCase();
    if (!['.pdf', '.docx'].includes(extension)) continue;

    const localRaw = await localExtract(fixturePath);
    const localResult = {
      text: localRaw.markdown ?? localRaw.text ?? '',
      extractionMethod: localRaw.extractionMethod ?? 'docling',
      characters: (localRaw.markdown ?? localRaw.text ?? '').length,
      truncated: Boolean(localRaw.truncated),
      droppedInfo: localRaw.droppedInfo ?? [],
      structured: localRaw.structured ?? null,
      providerRepresentation: localRaw.providerRepresentation ?? localRaw.structuredDict ?? null,
    };

    const remoteRaw = await remoteExtract({ filePath: fixturePath, env });
    const remoteResult = {
      text: remoteRaw.text ?? '',
      extractionMethod: remoteRaw.extractionMethod ?? 'docling-remote',
      characters: remoteRaw.characters ?? (remoteRaw.text ?? '').length,
      truncated: Boolean(remoteRaw.truncated),
      droppedInfo: remoteRaw.droppedInfo ?? [],
    };

    const localContract = validateExtractionProviderResult(localResult);
    const remoteContract = validateExtractionProviderResult(remoteResult);
    if (!localContract.ok) {
      errors.push(`${fixture.id}: local contract invalid (${localContract.errors.join('; ')})`);
    }
    if (!remoteContract.ok) {
      errors.push(`${fixture.id}: remote contract invalid (${remoteContract.errors.join('; ')})`);
    }

    const fidelity = tokenDiceSimilarity(localResult.text, remoteResult.text);
    const withinTolerance = fidelity >= tolerance;
    if (!withinTolerance) {
      errors.push(`${fixture.id}: fidelity ${fidelity.toFixed(3)} below tolerance ${tolerance}`);
    }

    fixtures.push({
      id: fixture.id,
      file: fixture.file,
      fidelity,
      withinTolerance,
      localContractOk: localContract.ok,
      remoteContractOk: remoteContract.ok,
      localChars: localResult.characters,
      remoteChars: remoteResult.characters,
    });
  }

  return {
    pass: errors.length === 0 && fixtures.length > 0,
    tolerance,
    fixtures,
    errors,
  };
}

export function buildCorpusSidecarStubExtract(corpusDir = CORPUS_DIR) {
  return async (fixturePath) => {
    const body = readFileSync(fixturePath);
    const marker = body.includes('Construct corpus')
      ? 'Construct corpus sidecar markdown body'
      : 'Docling sidecar OCR markdown body';
    return sidecarShapeFromRemote({
      text: `# ${marker}\n\nExtracted from ${fixturePath}`,
      characters: marker.length,
      truncated: false,
      droppedInfo: [],
    }, fixturePath);
  };
}

export function buildCorpusServeStubExtract(corpusDir = CORPUS_DIR) {
  const localStub = buildCorpusSidecarStubExtract(corpusDir);
  return async ({ filePath, env }) => {
    const local = await localStub(filePath);
    return {
      text: local.markdown ?? local.text,
      extractionMethod: 'docling-remote',
      characters: (local.markdown ?? local.text).length,
      truncated: false,
      droppedInfo: [],
    };
  };
}
