/**
 * tests/engine-compressor.test.mjs — TF-IDF heuristic compressor tests.
 *
 * Asserts:
 *   - Default ratio (0.5) produces output meaningfully shorter than input.
 *   - High-IDF sentences are preserved over filler.
 *   - maxTokens overrides ratio when it would yield fewer characters.
 *   - Empty / single-sentence inputs are returned as-is.
 *   - Sentence order is preserved relative to the source.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { create as createCompressor } from '../lib/engine/compressor-heuristic.mjs';

const SAMPLE = `
The construct retrieval engine combines BM25 keyword scoring with cosine
similarity over neural embeddings. RRF fuses the two ranked lists into
a single ranking. Maximal Marginal Relevance reranks the result for
diversity. The pipeline is corpus-agnostic.

Filler sentence one. Filler sentence two. Filler sentence three.

Plugin contracts let operators swap any layer without touching callers.
External git projects satisfy a layer by exporting a factory function.
`;

describe('heuristic TF-IDF compressor', () => {
  it('compresses to roughly the requested ratio', async () => {
    const c = createCompressor({ ratio: 0.5 });
    const out = await c.compress(SAMPLE);
    assert.ok(out.length < SAMPLE.length * 0.7, `expected < 70% size, got ${out.length}/${SAMPLE.length}`);
    assert.ok(out.length > 0);
  });

  it('keeps high-IDF sentences and drops filler', async () => {
    const c = createCompressor({ ratio: 0.4 });
    const out = await c.compress(SAMPLE);
    assert.match(out, /BM25|RRF|Marginal|Plugin/);
    assert.equal(/Filler sentence one/.test(out), false);
  });

  it('preserves source order of retained sentences', async () => {
    const c = createCompressor({ ratio: 0.5 });
    const out = await c.compress(SAMPLE);
    const rrfPos = out.indexOf('RRF');
    const mmrPos = out.indexOf('Maximal Marginal Relevance');
    if (rrfPos >= 0 && mmrPos >= 0) {
      assert.ok(rrfPos < mmrPos, 'RRF sentence must come before MMR sentence in output');
    }
  });

  it('maxTokens overrides ratio when it produces fewer characters', async () => {
    const c = createCompressor({ ratio: 1.0 });
    const out = await c.compress(SAMPLE, { maxTokens: 20 });
    assert.ok(out.length <= 20 * 4 + 200, `output should respect maxTokens, got ${out.length} chars`);
    assert.ok(out.length > 0);
  });

  it('returns empty string for empty input', async () => {
    const c = createCompressor();
    assert.equal(await c.compress(''), '');
  });

  it('returns single-sentence input as-is', async () => {
    const c = createCompressor({ ratio: 0.1 });
    const text = 'A single, indivisible thought about retrieval.';
    assert.equal(await c.compress(text), text);
  });
});
