/**
 * lib/document-extract/audio-provider-benchmark.mjs — whisper-cli vs Docling audio benchmark.
 *
 * Investigation-only harness for construct-tsyfe.2.10. Injectable extractors keep
 * the suite hermetic; live binaries are opt-in outside CI.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { CORPUS_DIR as DOC_CORPUS_DIR } from './corpus-benchmark.mjs';

export const AUDIO_CORPUS_DIR = join(DOC_CORPUS_DIR, '..', 'audio-extraction-corpus');
export const AUDIO_CORPUS_MANIFEST_PATH = join(AUDIO_CORPUS_DIR, 'manifest.json');

export function loadAudioCorpusManifest(manifestPath = AUDIO_CORPUS_MANIFEST_PATH) {
  const raw = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (!Array.isArray(raw.fixtures)) {
    throw new Error(`Invalid audio corpus manifest: missing fixtures[] at ${manifestPath}`);
  }
  return raw;
}

function normalizeTranscript(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function transcriptWordAccuracy(expected, actual) {
  const exp = new Set(normalizeTranscript(expected).split(/\s+/).filter(Boolean));
  const act = new Set(normalizeTranscript(actual).split(/\s+/).filter(Boolean));
  if (exp.size === 0 && act.size === 0) return 1;
  if (exp.size === 0 || act.size === 0) return 0;
  let overlap = 0;
  for (const word of exp) {
    if (act.has(word)) overlap += 1;
  }
  return overlap / exp.size;
}

/**
 * @param {object} [opts]
 * @param {Function} opts.whisperExtract async (fixturePath) => { transcript, latencyMs }
 * @param {Function} opts.doclingExtract async (fixturePath) => { transcript, latencyMs }
 * @returns {Promise<{ recommendation: string, fixtures: object[], pass: boolean }>}
 */
export async function runAudioProviderBenchmark({
  whisperExtract,
  doclingExtract,
  manifestPath = AUDIO_CORPUS_MANIFEST_PATH,
} = {}) {
  if (typeof whisperExtract !== 'function' || typeof doclingExtract !== 'function') {
    throw new Error('whisperExtract and doclingExtract are required');
  }

  const manifest = loadAudioCorpusManifest(manifestPath);
  const rows = [];

  for (const fixture of manifest.fixtures) {
    const fixturePath = join(AUDIO_CORPUS_DIR, fixture.file);
    if (!existsSync(fixturePath)) {
      throw new Error(`Missing audio fixture: ${fixturePath}`);
    }

    const whisper = await whisperExtract(fixturePath);
    const docling = await doclingExtract(fixturePath);
    const expected = fixture.expectedTranscript ?? '';

    rows.push({
      id: fixture.id,
      file: fixture.file,
      expectedTranscript: expected,
      whisper: {
        transcript: whisper.transcript,
        latencyMs: whisper.latencyMs,
        accuracy: transcriptWordAccuracy(expected, whisper.transcript),
      },
      docling: {
        transcript: docling.transcript,
        latencyMs: docling.latencyMs,
        accuracy: transcriptWordAccuracy(expected, docling.transcript),
      },
    });
  }

  const whisperAvgAccuracy = rows.reduce((sum, row) => sum + row.whisper.accuracy, 0) / rows.length;
  const doclingAvgAccuracy = rows.reduce((sum, row) => sum + row.docling.accuracy, 0) / rows.length;
  const whisperAvgLatency = rows.reduce((sum, row) => sum + row.whisper.latencyMs, 0) / rows.length;
  const doclingAvgLatency = rows.reduce((sum, row) => sum + row.docling.latencyMs, 0) / rows.length;

  const recommendation = whisperAvgAccuracy >= doclingAvgAccuracy - 0.05
    ? 'retain-whisper-cli'
    : 'consider-docling-consolidation';

  return {
    pass: rows.length > 0,
    recommendation,
    summary: {
      whisperAvgAccuracy,
      doclingAvgAccuracy,
      whisperAvgLatencyMs: whisperAvgLatency,
      doclingAvgLatencyMs: doclingAvgLatency,
    },
    fixtures: rows,
  };
}
