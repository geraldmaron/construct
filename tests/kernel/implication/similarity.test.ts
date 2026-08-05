/**
 * tests/kernel/implication/similarity.test.ts.
 *
 * The embedder is a stub on purpose, same reasoning as the namer stubs in
 * naming.test.ts: the kernel must be provably host-ignorant, and the live
 * signal quality is measured by script against a real model, not asserted here.
 * What these tests pin is the seam's contract — ranking, determinism, the
 * shortlist's exclusion rule, and that geometry never becomes an implication.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  domainText,
  rankBySimilarity,
  shortlist,
} from '../../../src/kernel/implication/similarity.ts';
import type { Embedder } from '../../../src/kernel/implication/similarity.ts';
import type { Domain } from '../../../src/kernel/implication/domains.ts';

const CATALOG: readonly Domain[] = [
  { path: 'privacy', domain: 'privacy', concern: 'personal data and consent', keywords: [] },
  { path: 'security', domain: 'security', concern: 'who can reach what', keywords: [] },
  { path: 'contracts', domain: 'contracts', concern: 'agreements and what they bind', keywords: [] },
];

/**
 * A deterministic stub: axis-aligned unit vectors per known text, so cosine
 * similarities are exact and readable (1 for a match, 0 for orthogonal).
 */
function axisEmbedder(assignments: Record<string, readonly number[]>): Embedder {
  return async (text) => {
    const vec = assignments[text];
    if (!vec) throw new Error(`stub asked to embed unexpected text: ${text}`);
    return vec;
  };
}

test('domains are ranked by cosine similarity to the outcome, strongest first', async () => {
  const ranked = await rankBySimilarity({
    outcome: 'keep client data in Germany',
    catalog: CATALOG,
    embedder: axisEmbedder({
      'keep client data in Germany': [1, 0.5, 0],
      [domainText(CATALOG[0]!)]: [1, 0, 0], // privacy: sim ~0.894
      [domainText(CATALOG[1]!)]: [0, 1, 0], // security: sim ~0.447
      [domainText(CATALOG[2]!)]: [0, 0, 1], // contracts: sim 0
    }),
  });
  assert.deepEqual(ranked.map((r) => [r.domain, r.rank]), [
    ['privacy', 1],
    ['security', 2],
    ['contracts', 3],
  ]);
  assert.ok(ranked[0]!.similarity > ranked[1]!.similarity);
  assert.ok(ranked[1]!.similarity > ranked[2]!.similarity);
});

test('equal similarities break ties by domain name, so ranking is deterministic', async () => {
  const same = [0, 1, 0] as const;
  const ranked = await rankBySimilarity({
    outcome: 'anything',
    catalog: CATALOG,
    embedder: axisEmbedder({
      anything: same,
      [domainText(CATALOG[0]!)]: same,
      [domainText(CATALOG[1]!)]: same,
      [domainText(CATALOG[2]!)]: same,
    }),
  });
  assert.deepEqual(ranked.map((r) => r.domain), ['contracts', 'privacy', 'security']);
});

test('the domain is embedded as name plus concern, and the representation is pinned', () => {
  // The measurement corpus and the runtime must embed the same string; a drift
  // here silently invalidates every recorded number.
  assert.equal(domainText(CATALOG[0]!), 'privacy: personal data and consent');
});

test('the shortlist excludes what keywords already implicated', async () => {
  const ranked = await rankBySimilarity({
    outcome: 'o',
    catalog: CATALOG,
    embedder: axisEmbedder({
      o: [1, 0, 0],
      [domainText(CATALOG[0]!)]: [1, 0, 0],
      [domainText(CATALOG[1]!)]: [0.9, 0.1, 0],
      [domainText(CATALOG[2]!)]: [0.8, 0.2, 0],
    }),
  });
  // privacy already implicated by keywords: the shortlist starts below it.
  assert.deepEqual(shortlist(ranked, ['privacy'], 2).map((r) => r.domain), [
    'security',
    'contracts',
  ]);
  // k caps the spend, not the exclusion.
  assert.deepEqual(shortlist(ranked, [], 1).map((r) => r.domain), ['privacy']);
  assert.deepEqual(shortlist(ranked, ['privacy', 'security', 'contracts'], 4), []);
});

test('a shortlist entry is a candidate, not an implication', async () => {
  const ranked = await rankBySimilarity({
    outcome: 'o',
    catalog: CATALOG,
    embedder: axisEmbedder({
      o: [1, 0, 0],
      [domainText(CATALOG[0]!)]: [1, 0, 0],
      [domainText(CATALOG[1]!)]: [0, 1, 0],
      [domainText(CATALOG[2]!)]: [0, 0, 1],
    }),
  });
  const candidates = shortlist(ranked, [], 3);
  // No entry carries a `signals` field: geometry is not a citation, and the
  // type system is where that rule lives rather than in reviewer vigilance.
  for (const c of candidates) assert.ok(!('signals' in c) && !('score' in c));
});

test('mismatched and degenerate vectors are rejected rather than silently scored', async () => {
  await assert.rejects(
    rankBySimilarity({
      outcome: 'o',
      catalog: [CATALOG[0]!],
      embedder: axisEmbedder({ o: [1, 0], [domainText(CATALOG[0]!)]: [1, 0, 0] }),
    }),
    RangeError,
  );
  await assert.rejects(
    rankBySimilarity({
      outcome: 'o',
      catalog: [CATALOG[0]!],
      embedder: axisEmbedder({ o: [0, 0, 0], [domainText(CATALOG[0]!)]: [1, 0, 0] }),
    }),
    RangeError,
  );
  assert.throws(() => shortlist([], [], -1), RangeError);
  assert.throws(() => shortlist([], [], 1.5), RangeError);
});

test('an embedder that throws propagates: a shortlist is optional, a wrong one is not', async () => {
  const exploding: Embedder = async () => {
    throw new Error('embedder unreachable');
  };
  // Unlike the namer in naming.ts (which degrades to a stated fallback, because silence
  // is a safe answer there), a failed embedder must not degrade to an empty
  // shortlist that looks identical to "nothing was similar". The caller decides
  // whether to skip the shortlist; this module does not decide for it.
  await assert.rejects(
    rankBySimilarity({ outcome: 'o', catalog: CATALOG, embedder: exploding }),
    /unreachable/,
  );
});
