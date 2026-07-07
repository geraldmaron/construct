/**
 * tests/security/misinformation-evidence-grounding.test.mjs — citation
 * grounding for web-capable specialists (construct-5wkl AC#5).
 *
 * @owasp LLM09
 * @secures research-synthesis
 *
 * lib/orchestration/provider-outcome.mjs:extractCitedUrls/findUnverifiedCitations
 * back the evidenceStatus/unverifiedCitations fields runTaskViaProvider
 * (lib/orchestration/worker.mjs) attaches to every web-capable task: a URL
 * the model cites that does not appear in the governed webEvidence list was
 * never actually retrieved through Construct's tool-use path, so it is
 * either fabricated outright or recalled from ungoverned model memory —
 * either way, misinformation the caller must not treat as verified. This
 * suite proves the detection primitives directly (tests/orchestration-worker-
 * web.test.mjs proves the same guarantee end to end through the mocked
 * provider loop for the research-synthesis role chain).
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { extractCitedUrls, findUnverifiedCitations } from '../../lib/orchestration/provider-outcome.mjs';

test('extractCitedUrls finds every http(s) URL and de-duplicates case/trailing-punctuation variants', () => {
  const text = 'Per https://Ex.com/a and https://ex.com/a/, plus (https://ex.com/b).';
  assert.deepEqual(extractCitedUrls(text), ['https://ex.com/a', 'https://ex.com/b']);
});

test('extractCitedUrls returns empty for non-string or citation-free text', () => {
  assert.deepEqual(extractCitedUrls(''), []);
  assert.deepEqual(extractCitedUrls(null), []);
  assert.deepEqual(extractCitedUrls('no links here'), []);
});

test('findUnverifiedCitations flags a citation absent from governed evidence', () => {
  const text = 'According to https://fabricated-source.example/nope, the claim holds.';
  const evidenceUrls = ['https://ex.com/b'];
  assert.deepEqual(findUnverifiedCitations(text, evidenceUrls), ['https://fabricated-source.example/nope']);
});

test('findUnverifiedCitations clears a citation that traces to governed evidence', () => {
  const text = 'Per https://ex.com/b, the claim holds.';
  const evidenceUrls = ['https://ex.com/b'];
  assert.deepEqual(findUnverifiedCitations(text, evidenceUrls), []);
});

test('findUnverifiedCitations partitions mixed grounded and fabricated citations in one answer', () => {
  const text = 'Confirmed at https://ex.com/b, but also see https://invented.example/report.';
  const evidenceUrls = ['https://ex.com/b'];
  assert.deepEqual(findUnverifiedCitations(text, evidenceUrls), ['https://invented.example/report']);
});

test('findUnverifiedCitations is a no-op when the answer cites nothing', () => {
  assert.deepEqual(findUnverifiedCitations('no citations in this answer', ['https://ex.com/b']), []);
});
