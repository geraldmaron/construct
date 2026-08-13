/**
 * tests/kernel/run/shapes.test.ts — the ask decides the shape, and three things
 * about that must stay true.
 *
 * The default cannot move. Every composition produced before shapes existed was
 * a review, and an ask that does not clearly want something else must still get
 * exactly that document — this widens what compose can produce and does not
 * reinterpret what it already produces.
 *
 * The decision shape must actually ask the questions the review shape never
 * posed, since that is the entire reason it exists: a recorded strategy ask came
 * back with no starting position, no alternatives, no price and no sequence, and
 * a shape that omits any of those has not fixed anything.
 *
 * And the chooser must be legible. It is keyword matching, it will be wrong, and
 * the cost of being wrong is one flag — so a name that does not exist fails
 * loudly rather than falling back to a default the user did not ask for.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  COMPOSITION_SHAPES,
  DEFAULT_SHAPE,
  shapeByName,
  shapeForOutcome,
  shapeNames,
} from '../../../src/kernel/run/shapes.ts';

test('the ask that produced the recorded failure now asks for a decision', () => {
  const asRecorded =
    'Decide what BlackStory should commit to over the next two releases: which capability ' +
    'earns the next block of work, what it should stop investing in, and what its evidence ' +
    'and living-person privacy obligations require before any of it ships';

  assert.equal(shapeForOutcome(asRecorded).name, 'decision');
});

test('the decision shape asks what the review shape never posed', () => {
  const decision = shapeForOutcome('Decide which capability we commit to next').sections.map((s) => s.name);

  // Each of these was missing from the recorded document, and each was missing
  // because nothing asked for it.
  assert.ok(decision.includes('where-things-stand'), 'a choice needs the position it is made from');
  assert.ok(decision.includes('what-was-on-the-table'), 'a recommendation with no alternatives was not chosen between');
  assert.ok(decision.includes('what-it-costs'), 'the work that stops is the part a plan hides');
  assert.ok(decision.includes('what-happens-first'), 'an order, not a list');
  assert.ok(decision.includes('what-would-change-it'), 'a decision nobody can falsify is a preference');
});

test('an ask that wants a report still gets exactly the review shape', () => {
  for (const outcome of [
    'Review the authentication flow and tell us what you find',
    'What does our roadmap say about the billing migration',
    'Assess whether the retention policy covers the new data',
  ]) {
    assert.equal(shapeForOutcome(outcome).name, 'review', outcome);
  }
  assert.deepEqual(shapeForOutcome('Review this').sections, DEFAULT_SHAPE.sections);
});

/**
 * "Plan" is the word the chooser deliberately does not read. Half its uses are
 * "tell me what the plan is", which is a review, and a chooser that gets the
 * common case wrong costs more than one that declines to guess.
 */
test('the chooser declines the words that go both ways', () => {
  assert.equal(shapeForOutcome('What is the plan for the migration').name, 'review');
  assert.equal(shapeForOutcome('Summarise the strategy document').name, 'review');
});

test('an unknown shape name is refused rather than silently defaulted', () => {
  assert.equal(shapeByName('narrative'), undefined);
  assert.equal(shapeByName('decision')?.name, 'decision');
  assert.equal(shapeByName('  DECISION ')?.name, 'decision', 'a user typing it is not a parser');
});

test('every shape names its sections uniquely and says what ask it answers', () => {
  const names = new Set<string>();
  for (const shape of COMPOSITION_SHAPES) {
    assert.ok(shape.answers.length > 0, `${shape.name} must say what it is for`);
    assert.ok(shape.sections.length > 0);
    assert.equal(names.has(shape.name), false, 'shape names are unique');
    names.add(shape.name);
    const sections = new Set(shape.sections.map((s) => s.name));
    assert.equal(sections.size, shape.sections.length, `${shape.name} repeats a section name`);
    for (const section of shape.sections) {
      assert.ok(section.expects.length > 0, `${shape.name}/${section.name} must say what it expects`);
    }
  }
  assert.deepEqual(shapeNames(), [...names]);
});
