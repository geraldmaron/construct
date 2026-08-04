/**
 * tests/kernel/implication/harvest.test.ts — construct-2jb.13.
 *
 * The properties under test are the ones that keep a harvested corpus honest:
 * verdicts become labels only in the direction the user actually judged, an
 * unjudged outcome is never admitted as data, and the same history always
 * harvests to the same corpus.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { harvestCorpus, harvestOutcome } from '../../../src/kernel/implication/harvest.ts';
import type { ImplicationFeedback } from '../../../src/kernel/implication/harvest.ts';

const AT = '2026-08-04T00:00:00.000Z';

function feedback(overrides: Partial<ImplicationFeedback> = {}): ImplicationFeedback {
  return {
    outcome: 'Our biggest client wants us to keep their data in Germany',
    verdicts: { privacy: 'missed', 'commerce-tax': 'dismissed', contracts: 'confirmed' },
    source: 'gerald',
    recordedAt: AT,
    category: 'legal',
    ...overrides,
  };
}

test('confirmed and missed become expected labels; dismissed becomes a negative label', () => {
  const o = harvestOutcome(feedback(), 'r1');
  assert.ok(o);
  assert.deepEqual(o.expect, ['contracts', 'privacy']);
  assert.deepEqual(o.provenance.rejected, ['commerce-tax']);
  assert.equal(o.provenance.source, 'gerald');
  assert.equal(o.provenance.recordedAt, AT);
});

test('the harvested shape is exactly what the corpus fixtures and map.test.ts consume', () => {
  const o = harvestOutcome(feedback(), 'r1');
  assert.ok(o);
  // The fields every existing fixture outcome carries, with the same types.
  assert.equal(typeof o.id, 'string');
  assert.equal(typeof o.category, 'string');
  assert.equal(typeof o.outcome, 'string');
  assert.ok(Array.isArray(o.expect));
});

test('an outcome nobody judged is not a labeled outcome', () => {
  assert.equal(harvestOutcome(feedback({ verdicts: {} }), 'r1'), null);
  assert.equal(harvestOutcome(feedback({ outcome: '   ' }), 'r1'), null);
});

test('a verdict outside the vocabulary is rejected, not coerced', () => {
  assert.throws(
    () =>
      harvestOutcome(
        feedback({ verdicts: { privacy: 'maybe' as unknown as 'confirmed' } }),
        'r1',
      ),
    RangeError,
  );
});

test('all dismissals is a real outcome with an empty expectation, not a skip', () => {
  // "Nothing you surfaced applied" is a strong label — the map over-included
  // everywhere — and must not be confused with "nobody judged it".
  const o = harvestOutcome(
    feedback({ verdicts: { privacy: 'dismissed', security: 'dismissed' } }),
    'r1',
  );
  assert.ok(o);
  assert.deepEqual(o.expect, []);
  assert.deepEqual(o.provenance.rejected, ['privacy', 'security']);
});

test('the same history always harvests to the same corpus', () => {
  const history = [feedback(), feedback({ verdicts: {} }), feedback({ category: undefined })];
  const a = harvestCorpus(history);
  const b = harvestCorpus(history);
  assert.deepEqual(a, b);
  assert.deepEqual(a.outcomes.map((o) => o.id), ['r1', 'r3']);
  assert.equal(a.skipped, 1);
  assert.equal(a.outcomes[1]!.category, 'uncategorized');
});

test('ids are positional over the full history, so a skip does not renumber later outcomes', () => {
  // r2 stays reserved for the skipped record: appending to a history must never
  // change the ids of outcomes already harvested from it.
  const history = [feedback({ verdicts: {} }), feedback()];
  assert.deepEqual(harvestCorpus(history).outcomes.map((o) => o.id), ['r2']);
});

test('the corpus document states its own tuning discipline', () => {
  const corpus = harvestCorpus([feedback()]);
  assert.match(corpus.discipline, /spent per catalog version/);
});
