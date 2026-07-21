/**
 * tests/document-extract/audio-provider-benchmark.test.mjs — whisper vs Docling audio benchmark (construct-tsyfe.2.10).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  runAudioProviderBenchmark,
  loadAudioCorpusManifest,
  transcriptWordAccuracy,
  AUDIO_CORPUS_DIR,
} from '../../lib/document-extract/audio-provider-benchmark.mjs';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

function readFixtureTranscript(fileName) {
  return readFileSync(join(AUDIO_CORPUS_DIR, fileName), 'utf8').trim();
}

test('audio corpus manifest lists three representative fixtures', () => {
  const manifest = loadAudioCorpusManifest();
  assert.equal(manifest.fixtures.length, 3);
  assert.ok(manifest.fixtures.some((f) => f.kind === 'noisy-background'));
});

test('transcriptWordAccuracy scores overlapping words', () => {
  assert.equal(transcriptWordAccuracy('hello construct world', 'hello construct world'), 1);
  assert.ok(transcriptWordAccuracy('hello construct world', 'hello world') >= 0.66);
});

test('runAudioProviderBenchmark recommends retaining whisper-cli on matched stub outputs', async () => {
  const manifest = loadAudioCorpusManifest();
  const whisperExtract = async (fixturePath) => {
    const body = readFileSync(fixturePath, 'utf8').trim();
    return { transcript: body, latencyMs: 120 };
  };
  const doclingExtract = async (fixturePath) => {
    const body = readFileSync(fixturePath, 'utf8').trim();
    return { transcript: `${body} with minor docling drift`, latencyMs: 480 };
  };

  const report = await runAudioProviderBenchmark({ whisperExtract, doclingExtract });
  assert.equal(report.pass, true);
  assert.equal(report.recommendation, 'retain-whisper-cli');
  assert.equal(report.fixtures.length, manifest.fixtures.length);
  for (const row of report.fixtures) {
    assert.ok(row.whisper.accuracy >= row.docling.accuracy - 0.05, `${row.id} whisper accuracy regressed`);
    assert.ok(row.whisper.latencyMs < row.docling.latencyMs, `${row.id} whisper latency advantage expected in stub benchmark`);
  }
});

test('runAudioProviderBenchmark records per-fixture accuracy and latency table', async () => {
  const report = await runAudioProviderBenchmark({
    whisperExtract: async (fixturePath) => ({
      transcript: readFixtureTranscript(basename(fixturePath)),
      latencyMs: 100,
    }),
    doclingExtract: async (fixturePath) => ({
      transcript: readFixtureTranscript(basename(fixturePath)),
      latencyMs: 900,
    }),
  });

  assert.ok(report.summary.whisperAvgAccuracy >= 0.99);
  assert.ok(report.summary.doclingAvgAccuracy >= 0.99);
  assert.ok(typeof report.summary.whisperAvgLatencyMs === 'number');
  assert.ok(typeof report.summary.doclingAvgLatencyMs === 'number');
});
