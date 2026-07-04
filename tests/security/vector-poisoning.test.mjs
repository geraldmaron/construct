/**
 * tests/security/vector-poisoning.test.mjs — Vector-store poisoning defenses
 * for the retrieval/recall path (construct-9oi4.14.4, LMCP-N4).
 *
 * @owasp LLM04, LLM08
 * @secures research-synthesis
 *
 * N1 (construct-9oi4.14.1, lib/security/trust.mjs) stamps ingested content
 * with a trust label but the retrieval path itself had no defense against a
 * poisoned embedding dominating recall by cosine similarity alone. This
 * suite extends the F08 adversarial corpus
 * (tests/audit/f08-prompt-injection/adversarial-corpus.red.mjs
 * INJECTION_CORPUS) into a retrieval-side proof: every corpus payload is
 * built into a same-shaped mock result set alongside legitimate trusted
 * results and driven through lib/storage/retrieval-hardening.mjs, asserting
 * the two N4 acceptance criteria directly:
 *
 *   1. a poisoned/adversarial source cannot occupy more than the configured
 *      per-source recall cap of the assembled context set;
 *   2. an untrusted-source result ranks below a trusted result at equal
 *      similarity.
 *
 * Also covers the remaining required shape: similarity sanity thresholds,
 * duplicate-content collapse, and the retrieval-frequency anomaly check.
 *
 * Run: node --test tests/security/vector-poisoning.test.mjs
 *
 * References: CX-AUDIT-LLMSEC-001, OWASP GenAI vector/embedding weaknesses,
 * construct-9oi4.14.4, construct-9oi4.14.1.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { INJECTION_CORPUS } from '../audit/f08-prompt-injection/adversarial-corpus.red.mjs';
import { TRUST_LEVELS, stampTrust } from '../../lib/security/trust.mjs';
import {
  DEFAULT_HARDENING_OPTIONS,
  applyPerSourceCap,
  applySanityThreshold,
  applyTrustWeightedRanking,
  collapseDuplicates,
  flagRetrievalAnomalies,
  hardenRetrieval,
  sourceIdentityOf,
} from '../../lib/storage/retrieval-hardening.mjs';

// Builds a mock recall record shaped like a VectorClient search result
// (similarity + _trust + source), the minimal fields hardenRetrieval reads.

function mockResult({ id, source, similarity, level, content }) {
  return stampTrust(
    { id, source, similarity, content: content ?? id },
    level,
    source,
  );
}

// ---------------------------------------------------------------------------
// Acceptance 1: a poisoned doc cannot occupy more than the cap of assembled
// context, using the F08 adversarial corpus as the poisoned payload set.
// ---------------------------------------------------------------------------

test('[N4] F08 adversarial corpus: poisoned source cannot exceed the per-source recall cap', () => {
  // One adversarial source floods recall with every INJECTION_CORPUS payload
  // plus repeats, standing in for an attacker who has poisoned many chunks
  // of a single ingested document to dominate cosine-similarity recall.

  const poisonedSource = 'https://malicious.example/poisoned-doc';
  const poisoned = [];
  for (let i = 0; i < 20; i += 1) {
    const payload = INJECTION_CORPUS[i % INJECTION_CORPUS.length];
    poisoned.push(mockResult({
      id: `poison-${i}`,
      source: poisonedSource,
      similarity: 0.97,
      level: TRUST_LEVELS.EXTERNAL_UNAUTHENTICATED,
      content: `${payload.id}: ${payload.text} (variant ${i})`,
    }));
  }

  // A handful of legitimate, distinct trusted sources.

  const legitimate = Array.from({ length: 10 }, (_, i) => mockResult({
    id: `legit-${i}`,
    source: `trusted-source-${i}`,
    similarity: 0.9,
    level: TRUST_LEVELS.TRUSTED_INTERNAL,
    content: `Legitimate internal content number ${i}, unique body text.`,
  }));

  // limit models the real hybrid-query.mjs call site: the assembled-context
  // size is the caller's requested recall limit, not the raw candidate pool
  // (30 candidates fetched, 20 assembled into context).

  const merged = [...poisoned, ...legitimate].sort((a, b) => b.similarity - a.similarity);
  const hardened = hardenRetrieval(merged, { limit: 20 });

  const poisonedCount = hardened.filter((r) => sourceIdentityOf(r) === poisonedSource).length;
  const cap = Math.max(1, Math.floor(20 * DEFAULT_HARDENING_OPTIONS.perSourceCapRatio));

  assert.ok(hardened.length > 0, 'precondition: hardened result set is non-empty');
  assert.ok(
    poisonedCount <= cap,
    `poisoned source occupies ${poisonedCount} of ${hardened.length} assembled results, exceeding cap ${cap}`,
  );
  assert.ok(
    poisonedCount < poisoned.length,
    'precondition: the cap must actually have trimmed the poisoned source (else the test proves nothing)',
  );
});

test('[N4] per-source cap holds directly against applyPerSourceCap for each F08 corpus id', () => {
  for (const probe of INJECTION_CORPUS) {
    const poisonedSource = `attacker-source-${probe.id}`;
    const results = [
      ...Array.from({ length: 15 }, (_, i) => mockResult({
        id: `${probe.id}-${i}`,
        source: poisonedSource,
        similarity: 0.95,
        level: TRUST_LEVELS.EXTERNAL_UNAUTHENTICATED,
        content: `${probe.text} #${i}`,
      })),
      ...Array.from({ length: 5 }, (_, i) => mockResult({
        id: `other-${probe.id}-${i}`,
        source: `benign-source-${i}`,
        similarity: 0.8,
        level: TRUST_LEVELS.TEAM_AUTHORED,
      })),
    ];

    const capped = applyPerSourceCap(results, { perSourceCapRatio: 0.34, assembledSize: results.length });
    const cap = Math.max(1, Math.floor(results.length * 0.34));
    const count = capped.filter((r) => sourceIdentityOf(r) === poisonedSource).length;

    assert.ok(count <= cap, `[${probe.id}] poisoned source count ${count} exceeds cap ${cap}`);
  }
});

// ---------------------------------------------------------------------------
// Acceptance 2: untrusted-source results rank below trusted at equal
// similarity.
// ---------------------------------------------------------------------------

test('[N4] untrusted-source result ranks below trusted result at equal similarity', () => {
  for (const probe of INJECTION_CORPUS) {
    const untrusted = mockResult({
      id: `untrusted-${probe.id}`,
      source: 'https://attacker.example/doc',
      similarity: 0.88,
      level: TRUST_LEVELS.EXTERNAL_UNAUTHENTICATED,
      content: probe.text,
    });
    const trusted = mockResult({
      id: `trusted-${probe.id}`,
      source: 'internal-docs',
      similarity: 0.88,
      level: TRUST_LEVELS.TRUSTED_INTERNAL,
      content: 'Legitimate trusted content at equal similarity.',
    });

    // Insert untrusted first so a naive stable sort by similarity alone
    // would keep it ahead — proving the ranking is trust-aware, not an
    // artifact of input order.

    const ranked = applyTrustWeightedRanking([untrusted, trusted]);

    assert.equal(ranked[0].id, trusted.id, `[${probe.id}] trusted result must rank first at equal similarity`);
    assert.equal(ranked[1].id, untrusted.id, `[${probe.id}] untrusted result must rank second`);
  }
});

test('[N4] unstamped records are graded EXTERNAL_UNAUTHENTICATED and still rank below trusted', () => {
  const unstamped = { id: 'unstamped', source: 'unknown-origin', similarity: 0.9, content: 'no trust stamp' };
  const trusted = mockResult({ id: 'trusted', source: 'internal', similarity: 0.9, level: TRUST_LEVELS.TEAM_AUTHORED });

  const ranked = applyTrustWeightedRanking([unstamped, trusted]);
  assert.equal(ranked[0].id, 'trusted', 'unstamped record must not outrank a team-authored record at equal similarity');
});

test('[N4] trust ranking only breaks ties within the similarity epsilon band', () => {
  const clearlyBetterUntrusted = mockResult({
    id: 'better-untrusted', source: 'attacker', similarity: 0.99, level: TRUST_LEVELS.EXTERNAL_UNAUTHENTICATED,
  });
  const worseTrusted = mockResult({
    id: 'worse-trusted', source: 'internal', similarity: 0.5, level: TRUST_LEVELS.TRUSTED_INTERNAL,
  });

  const ranked = applyTrustWeightedRanking([worseTrusted, clearlyBetterUntrusted], { epsilon: 0.02 });
  assert.equal(ranked[0].id, 'better-untrusted', 'a much higher similarity match must still win outside the epsilon band');
});

// ---------------------------------------------------------------------------
// Distance / similarity sanity thresholds
// ---------------------------------------------------------------------------

test('[N4] sanity threshold drops non-finite, negative, and over-range similarity values', () => {
  const results = [
    { id: 'good', similarity: 0.5 },
    { id: 'nan', similarity: NaN },
    { id: 'negative', similarity: -0.4 },
    { id: 'too-high', similarity: 5 },
    { id: 'floor', similarity: DEFAULT_HARDENING_OPTIONS.minSimilarity - 0.001 },
  ];

  const filtered = applySanityThreshold(results);
  assert.deepEqual(filtered.map((r) => r.id), ['good']);
});

// ---------------------------------------------------------------------------
// Duplicate-content collapse
// ---------------------------------------------------------------------------

test('[N4] duplicate-content collapse keeps only the top-ranked copy of restated payloads', () => {
  for (const probe of INJECTION_CORPUS) {
    const results = [
      mockResult({ id: 'copy-1', source: 'attacker-a', similarity: 0.95, level: TRUST_LEVELS.EXTERNAL_UNAUTHENTICATED, content: probe.text }),
      mockResult({ id: 'copy-2', source: 'attacker-b', similarity: 0.9, level: TRUST_LEVELS.EXTERNAL_UNAUTHENTICATED, content: probe.text }),
      mockResult({ id: 'copy-3', source: 'attacker-c', similarity: 0.85, level: TRUST_LEVELS.EXTERNAL_UNAUTHENTICATED, content: `  ${probe.text}   ` }),
    ];

    const deduped = collapseDuplicates(results);
    assert.equal(deduped.length, 1, `[${probe.id}] restated copies of the same payload must collapse to one`);
    assert.equal(deduped[0].id, 'copy-1', `[${probe.id}] the highest-ranked copy must be kept`);
  }
});

test('[N4] duplicate collapse preserves distinct content', () => {
  const results = [
    { id: 'a', similarity: 0.9, content: 'alpha content body' },
    { id: 'b', similarity: 0.8, content: 'completely unrelated beta text' },
  ];
  assert.equal(collapseDuplicates(results).length, 2);
});

// ---------------------------------------------------------------------------
// Retrieval-frequency anomaly check
// ---------------------------------------------------------------------------

test('[N4] flagRetrievalAnomalies flags a source with outlier retrieval frequency', () => {
  const results = [
    ...Array.from({ length: 12 }, (_, i) => ({ id: `outlier-${i}`, source: 'attacker-flood' })),
    ...Array.from({ length: 2 }, (_, i) => ({ id: `normal-a-${i}`, source: 'source-a' })),
    ...Array.from({ length: 2 }, (_, i) => ({ id: `normal-b-${i}`, source: 'source-b' })),
    ...Array.from({ length: 1 }, (_, i) => ({ id: `normal-c-${i}`, source: 'source-c' })),
  ];

  const { flagged, sourceCounts } = flagRetrievalAnomalies(results);
  assert.equal(sourceCounts['attacker-flood'], 12);
  assert.ok(flagged.some((f) => f.source === 'attacker-flood'), 'flood source must be flagged as an anomaly');
});

test('[N4] flagRetrievalAnomalies does not flag a roughly uniform distribution', () => {
  const results = [
    ...Array.from({ length: 3 }, (_, i) => ({ id: `a-${i}`, source: 'source-a' })),
    ...Array.from({ length: 3 }, (_, i) => ({ id: `b-${i}`, source: 'source-b' })),
    ...Array.from({ length: 3 }, (_, i) => ({ id: `c-${i}`, source: 'source-c' })),
    ...Array.from({ length: 4 }, (_, i) => ({ id: `d-${i}`, source: 'source-d' })),
  ];

  const { flagged } = flagRetrievalAnomalies(results);
  assert.equal(flagged.length, 0, 'a roughly uniform distribution must not be flagged');
});

test('[N4] flagRetrievalAnomalies is inconclusive (no flags) with fewer than 3 sources', () => {
  const results = [
    ...Array.from({ length: 10 }, (_, i) => ({ id: `a-${i}`, source: 'source-a' })),
    { id: 'b-0', source: 'source-b' },
  ];
  const { flagged } = flagRetrievalAnomalies(results);
  assert.equal(flagged.length, 0, 'fewer than 3 distinct sources is not a meaningful distribution');
});

// ---------------------------------------------------------------------------
// Full pipeline: end-to-end shape check against the whole F08 corpus at once
// ---------------------------------------------------------------------------

test('[N4] hardenRetrieval pipeline: full F08 corpus flood stays capped and ranked below trusted', () => {
  const poisonedSource = 'https://attacker.example/all-corpus';
  const poisoned = INJECTION_CORPUS.map((probe, i) => mockResult({
    id: `flood-${probe.id}`,
    source: poisonedSource,
    similarity: 0.96 - i * 0.001,
    level: TRUST_LEVELS.EXTERNAL_UNAUTHENTICATED,
    content: probe.text,
  }));
  const trusted = mockResult({
    id: 'trusted-anchor', source: 'internal-anchor', similarity: 0.96, level: TRUST_LEVELS.TRUSTED_INTERNAL,
    content: 'Trusted anchor content, distinct from any corpus payload.',
  });

  const hardened = hardenRetrieval([...poisoned, trusted]);
  const cap = Math.max(1, Math.floor(hardened.length * DEFAULT_HARDENING_OPTIONS.perSourceCapRatio));
  const poisonedCount = hardened.filter((r) => sourceIdentityOf(r) === poisonedSource).length;

  assert.ok(poisonedCount <= cap, `poisoned corpus flood occupies ${poisonedCount}, exceeding cap ${cap}`);
  assert.equal(hardened[0].id, 'trusted-anchor', 'trusted anchor must outrank the untrusted flood at equal similarity');
});
