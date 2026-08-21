/**
 * tests/kernel/run/shape-fallback.test.ts — the keyword chooser must be able to
 * say it matched nothing.
 *
 * The default shape has no signal list, so it is the only answer reachable
 * without matching a phrase. That makes "the phrases chose review" and "nothing
 * matched, so you get the default" the same output to anyone reading the shape
 * alone — and measured against asks the lists were not written against, the
 * second case is the common one. A caller that discloses a fallback needs to be
 * able to tell a reader which of the two it is holding, so the distinction is
 * carried on the result rather than reconstructed by guessing.
 *
 * The corpus behind that measurement is tests/kernel/run/fixtures/shape-asks.json
 * and no test asserts a rate against it, deliberately: a corpus that gates a
 * build is a corpus the next change is tuned against.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SHAPE,
  shapeForOutcome,
  shapeMatchForOutcome,
} from '../../../src/kernel/run/shapes.ts';

test('an ask no phrase matches reports the default as unmatched', () => {
  // Plainly an architecture decision record in meaning, and it names none of
  // the phrases, which is exactly the case the disclosure exists for.
  const choice = shapeMatchForOutcome(
    'Put the reasoning somewhere permanent, with what it costs us, so I stop relitigating it every term',
  );

  assert.equal(choice.shape, DEFAULT_SHAPE);
  assert.equal(choice.matched, false);
});

test('an ask that names its document type reports a match', () => {
  const choice = shapeMatchForOutcome('Write an ADR for the caching layer');

  assert.equal(choice.shape.name, 'adr');
  assert.equal(choice.matched, true);
});

test('landing on the default by matching is distinguishable from falling through to it', () => {
  // Both return the review shape. Only one of them read the ask to get there,
  // and a caller that cannot tell them apart cannot report either honestly.
  const fellThrough = shapeMatchForOutcome('Have a look at the thing and tell me what you think');

  assert.equal(fellThrough.shape, DEFAULT_SHAPE);
  assert.equal(fellThrough.matched, false);

  // A phrase match that lands somewhere other than the default proves `matched`
  // tracks the phrase lists rather than simply restating which shape came back.
  const matched = shapeMatchForOutcome('Write a spec for the export tool');
  assert.notEqual(matched.shape, DEFAULT_SHAPE);
  assert.equal(matched.matched, true);
});

test('the shape-only chooser answers exactly as the reporting one does', () => {
  // One matcher backs both. If these ever disagree, the ordering has been
  // copied rather than shared.
  for (const outcome of [
    'Write an RFC for the caching layer',
    'Write an ADR for the caching layer',
    'Write a spec for the export tool',
    'Decide which capability we commit to next',
    'Have a look at the thing and tell me what you think',
  ]) {
    assert.equal(shapeForOutcome(outcome), shapeMatchForOutcome(outcome).shape, outcome);
  }
});

test('a one-pager ask reaches the one-pager through the keyword path, and outranks a decision word beside it', () => {
  const asked = shapeMatchForOutcome('Draft a one-pager for the board deciding whether to ship');
  assert.equal(asked.shape.name, 'onepager');
  assert.equal(asked.matched, true);
  const review = shapeMatchForOutcome('Summarize this review');
  assert.equal(review.shape.name, 'review');
  assert.equal(review.matched, false);
});
