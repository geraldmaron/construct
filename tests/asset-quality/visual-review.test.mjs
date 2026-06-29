/**
 * tests/asset-quality/visual-review.test.mjs — Guards the visually-reviewed contract.
 *
 * The visually-reviewed rung is reachable only from non-degraded screenshot-captured evidence plus
 * a valid rubric-based review report — never from source. The verdict rides in the proof so a
 * passing or failing review both record that a review occurred, while the gate to approved stays
 * separate.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RUBRICS,
  VERDICTS,
  makeVisualReview,
  recordVisualReview,
} from '../../lib/visual-review.mjs';
import { makeEvidence, recordCompletion, highestState } from '../../lib/artifact-completion.mjs';

const capturedShot = makeEvidence('screenshot-captured', {
  actor: 'construct-render',
  artifact: 'prd.pdf',
  proof: { images: ['prd-1.png'], count: 1 },
});

test('the rubric registry maps ids to criteria and applicable formats', () => {
  for (const rubric of Object.values(RUBRICS)) {
    assert.ok(rubric.criteria.length > 0);
    assert.ok(rubric.applies.length > 0);
  }
  assert.ok(RUBRICS['deck-v1'].applies.includes('pptx'));
});

test('makeVisualReview rejects an unknown rubric, bad verdict, or missing image', () => {
  assert.throws(() => makeVisualReview({ rubricId: 'nope', image: 'x.png', verdict: 'pass', reviewer: 'r' }), /unknown rubric/);
  assert.throws(() => makeVisualReview({ rubricId: 'document-v1', image: 'x.png', verdict: 'great', reviewer: 'r' }), /unknown verdict/);
  assert.throws(() => makeVisualReview({ rubricId: 'document-v1', image: '', verdict: 'pass', reviewer: 'r' }), /rendered image/);
});

test('a visual review cannot be recorded without a real captured screenshot', () => {
  const review = makeVisualReview({ rubricId: 'document-v1', image: 'prd-1.png', verdict: 'pass', reviewer: 'cx-designer' });
  assert.throws(() => recordVisualReview({ screenshotEvidence: null, review }), /no source inference/);
  const degraded = makeEvidence('screenshot-captured', { actor: 'construct-render', degradation: 'unavailable-renderer' });
  assert.throws(() => recordVisualReview({ screenshotEvidence: degraded, review }), /no source inference/);
});

test('a recorded review from a real screenshot advances the ladder, verdict in proof', () => {
  const review = makeVisualReview({ rubricId: 'document-v1', image: 'prd-1.png', verdict: 'pass', reviewer: 'cx-designer' });
  const evidence = recordVisualReview({ screenshotEvidence: capturedShot, review });
  assert.equal(evidence.state, 'visually-reviewed');
  assert.equal(evidence.proof.verdict, 'pass');
  assert.equal(evidence.degradation, null);
  assert.equal(highestState(recordCompletion([], evidence)), 'visually-reviewed');
});

test('a failing verdict still records that a review occurred', () => {
  const review = makeVisualReview({ rubricId: 'deck-v1', image: 'slide-1.png', verdict: 'fail', reviewer: 'cx-designer' });
  const evidence = recordVisualReview({ screenshotEvidence: capturedShot, review });
  assert.equal(evidence.state, 'visually-reviewed');
  assert.equal(evidence.proof.verdict, 'fail');
  assert.ok(VERDICTS.includes(evidence.proof.verdict));
});
