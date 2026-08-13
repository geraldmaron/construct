/**
 * The boundary between the record and the reader.
 *
 * The property these tests exist to hold is that rendering is a view: the
 * stored text keeps every marker and every gate keeps reading them, and only
 * the copy a person receives changes. A rendering that quietly weakened what a
 * marker meant would be the softening the markers exist to prevent, wearing a
 * house style.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  renderAttribution,
  renderClaim,
  renderHeading,
} from '../../../src/kernel/run/publish.ts';
import { runStructuralChallenges } from '../../../src/kernel/challenge/catalog.ts';
import type { Brief } from '../../../src/kernel/brief/schema.ts';

const BRIEF: Brief = {
  id: 't-privacy',
  outcome: 'Decide what to fund over the next two releases',
  role: 'privacy',
  inputs: [],
  capabilities: [],
  postconditions: [],
  challenges: ['claims-cited'],
};

test('an unverified tag becomes a request for the work it names', () => {
  const rendered = renderClaim('Four source captures exist against a 95% bar [unverified].');

  assert.doesNotMatch(rendered, /\[unverified\]/);
  assert.match(rendered, /still needs checking against a source/);
});

test('an unowned marker names the gap as something somebody must do', () => {
  const rendered = renderClaim('The canonical-write reauth gap [unowned] blocks the beta gate.');

  assert.doesNotMatch(rendered, /\[unowned\]/);
  assert.match(rendered, /nobody is named for this yet/);
});

test('a citation reads the way a colleague gives one', () => {
  const rendered = renderClaim(
    'Registry entries default to disabled [cite:/Users/g/blackstory/docs/research/audit.md].',
  );

  assert.doesNotMatch(rendered, /\[cite:/);
  assert.match(rendered, /\(research\/audit\.md\)/);
});

test('an assumption is rendered as one, not as a field', () => {
  const rendered = renderClaim('The switches moved [assumed: Firestore is no longer the read path].');

  assert.match(rendered, /taking it that Firestore is no longer the read path/);
});

/**
 * Rendered text carries no markers, so rendering it again changes nothing. A
 * surface that re-renders on a redraw would otherwise accumulate clauses until
 * the sentence stopped being one.
 */
test('rendering twice is rendering once', () => {
  const once = renderClaim('Four captures exist [unverified] per the bar [cite:docs/ops/bar.md].');

  assert.equal(renderClaim(once), once);
});

/**
 * The whole design rests on this. If rendering happened on the way in, the
 * citation gate would stop seeing the tag it counts, and the check would pass
 * on prose that no longer says what it said.
 */
test('the record the gates read is untouched by what the reader is shown', () => {
  const recorded = 'The bar is 95% [unverified] and four captures exist [unverified].';

  const before = runStructuralChallenges(BRIEF, recorded);
  renderClaim(recorded);
  const after = runStructuralChallenges(BRIEF, recorded);

  assert.deepEqual(before.results, after.results);
  assert.equal(before.results[0].passed, true);
});

/**
 * And the converse, which is why this is a publish-time view and not a
 * migration: rendered text would not survive the gate, because the marker the
 * gate counts is exactly what rendering removes.
 */
test('rendered text is not what a gate should ever be handed', () => {
  const rendered = renderClaim('The bar is 95% [unverified].');

  assert.equal(runStructuralChallenges(BRIEF, rendered).results[0].passed, false);
});

test('a section slug becomes a sentence, not Title Case', () => {
  assert.equal(renderHeading('what-would-change-it'), 'What would change it');
  assert.equal(renderHeading('the-choice'), 'The choice');
});

test('a concern id becomes the English it already was', () => {
  assert.equal(renderAttribution('evidence-provenance'), 'evidence provenance');
});
