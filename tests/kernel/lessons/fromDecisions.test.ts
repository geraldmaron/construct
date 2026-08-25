/**
 * tests/kernel/lessons/fromDecisions.test.ts — a resolved decision, transcribed
 * mechanically into a lesson candidate.
 *
 * The property held here: everything in the lesson body traces to a typed
 * column on the decision (question, positions, resolution) — nothing is
 * inferred, and an open decision produces nothing to distill.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { distillDecisionLesson, DECISION_CITATION_PREFIX } from '../../../src/kernel/lessons/fromDecisions.ts';
import type { Decision } from '../../../src/kernel/store/decisions.ts';

const RESOLVED: Decision = {
  id: 'run-1:stance',
  run: 'run-1',
  state: 'resolved',
  question: 'ship mobile-launch-completion or UGC first?',
  positions: [
    { role: 'strategy-alignment', stance: 'mobile-launch-completion first', citation: 'task:t-1#L1' },
    { role: 'product-scoping', stance: 'UGC first', citation: 'task:t-2#L1' },
  ],
  raisedAt: '2026-08-13T00:00:00.000Z',
  resolvedAt: '2026-08-13T01:00:00.000Z',
  resolution: 'mobile-launch-completion first; UGC waits for the next cycle',
  resolvedBy: 'cli:user',
};

test('a resolved decision distills to a lesson naming both sides and the resolution', () => {
  const lesson = distillDecisionLesson(RESOLVED);
  assert.ok(lesson);
  assert.equal(lesson.id, 'lesson-run-1:stance');
  assert.equal(lesson.citation, `${DECISION_CITATION_PREFIX}run-1:stance`);
  assert.match(lesson.body, /mobile-launch-completion or UGC first\?/);
  assert.match(lesson.body, /strategy-alignment held: "mobile-launch-completion first"/);
  assert.match(lesson.body, /product-scoping held: "UGC first"/);
  assert.match(lesson.body, /Resolved: "mobile-launch-completion first; UGC waits for the next cycle"/);
  assert.deepEqual(lesson.domains, ['strategy-alignment', 'product-scoping']);
});

test('an open decision distills to nothing — there is no resolution yet to learn from', () => {
  const open: Decision = { ...RESOLVED, state: 'open', resolvedAt: null, resolution: null };
  assert.equal(distillDecisionLesson(open), null);
});

test('a role named on both sides of separate positions is not double-counted as a domain', () => {
  const repeated: Decision = {
    ...RESOLVED,
    positions: [
      { role: 'strategy-alignment', stance: 'A', citation: 'task:t-1#L1' },
      { role: 'strategy-alignment', stance: 'A, restated', citation: 'task:t-1#L2' },
      { role: 'product-scoping', stance: 'B', citation: 'task:t-2#L1' },
    ],
  };
  assert.deepEqual(distillDecisionLesson(repeated)!.domains, ['strategy-alignment', 'product-scoping']);
});

/**
 * Measured against a real recorded run (run-20260813172834638:stance):
 * Construct's own reversible-default note rides in `positions` under the
 * role name "construct" beside the real specialists. Folding it into "roles
 * held" the same way a cited specialist stance is folded in would misstate
 * it as a role's finding — a lesson-worthy defect this is fixed against
 * rather than left for the next distillation to reintroduce.
 */
test('the reversible-default note under role "construct" is not a specialist and is excluded', () => {
  const withDefault: Decision = {
    ...RESOLVED,
    positions: [
      ...RESOLVED.positions,
      { role: 'construct', stance: 'the reversible default if you do nothing: this holds', citation: null },
    ],
  };
  const lesson = distillDecisionLesson(withDefault);
  assert.ok(!lesson!.body.includes('construct held'));
  assert.ok(!lesson!.domains.includes('construct'));
  assert.deepEqual(lesson!.domains, ['strategy-alignment', 'product-scoping']);
});
