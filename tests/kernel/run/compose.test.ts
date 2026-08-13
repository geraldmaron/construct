/**
 * tests/kernel/run/compose.test.ts — one document from the several a run
 * produced, and the discipline that makes composing safe.
 *
 * The property that matters: a composition may arrange what the roles
 * established and may not add to it. Everything here defends that — an
 * attribution to a role that produced nothing is fabricated provenance, and a
 * run with one deliverable has nothing to compose, because arranging one
 * document into one document is a paraphrase of checked work into unchecked
 * work.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  claimsFrom,
  composeReadiness,
  screenComposition,
  toComposition,
} from '../../../src/kernel/run/compose.ts';
import type { SourceDeliverable } from '../../../src/kernel/run/compose.ts';

const SOURCES: SourceDeliverable[] = [
  { role: 'strategy-alignment', text: '## the-bet\nThe pilot is worth its price.' },
  { role: 'product-scoping', text: '## in-scope\nSSO ships in Q4.' },
];

test('a well-formed composition passes through with its gaps intact', () => {
  const composition = toComposition({
    claims: [
      { section: 'the-answer', text: 'The pilot is worth its price', from: 'strategy-alignment' },
      { section: 'what-follows', text: 'SSO ships in Q4', from: 'product-scoping' },
    ],
    uncovered: ['nobody addressed the migration sequence'],
  });
  const screened = screenComposition(composition, SOURCES);
  assert.equal(screened.claims.length, 2);
  assert.equal(screened.discarded.length, 0);
  assert.deepEqual(screened.uncovered, ['nobody addressed the migration sequence']);
});

test('a claim attributed to a role that produced nothing is refused, not judged', () => {
  const composition = toComposition({
    claims: [
      { section: 'the-answer', text: 'The pilot is worth its price', from: 'strategy-alignment' },
      { section: 'what-follows', text: 'The migration takes six weeks', from: 'program-sequencing' },
    ],
    uncovered: [],
  });
  const screened = screenComposition(composition, SOURCES);
  assert.deepEqual(screened.claims.map((c) => c.from), ['strategy-alignment']);
  assert.equal(screened.discarded.length, 1);
  assert.match(screened.discarded[0]!.reason, /produced no deliverable in this run/);
  assert.match(screened.discarded[0]!.reason, /may not add to it/);
});

test('a claim missing its section, text, or attribution is not a claim', () => {
  const composition = toComposition({
    claims: [
      { section: 'the-answer', text: 'kept', from: 'product-scoping' },
      { section: '', text: 'no section', from: 'product-scoping' },
      { section: 'the-answer', text: '', from: 'product-scoping' },
      { section: 'the-answer', text: 'no attribution', from: '' },
      'not an object',
    ],
    uncovered: ['', '   ', 'a real gap'],
  });
  assert.deepEqual(composition.claims.map((c) => c.text), ['kept']);
  assert.deepEqual(composition.uncovered, ['a real gap'], 'an empty gap is not a gap');
});

test('a shapeless reply composes nothing rather than throwing', () => {
  assert.deepEqual(toComposition(null), { claims: [], uncovered: [] });
  assert.deepEqual(toComposition({}), { claims: [], uncovered: [] });
});

test('claims are split by the role they will be checked against', () => {
  const claims = [
    { section: 'the-answer', text: 'a', from: 'product-scoping' },
    { section: 'what-follows', text: 'b', from: 'strategy-alignment' },
    { section: 'what-follows', text: 'c', from: 'product-scoping' },
  ];
  assert.deepEqual(claimsFrom(claims, 'product-scoping').map((c) => c.text), ['a', 'c']);
  assert.deepEqual(claimsFrom(claims, 'nobody'), []);
});

test('one deliverable has nothing to compose, and says why rather than paraphrasing it', () => {
  const one = composeReadiness([SOURCES[0]!]);
  assert.equal(one.ready, false);
  assert.match(one.reason, /only strategy-alignment produced a deliverable/);
  assert.match(one.reason, /paraphrase/);

  const none = composeReadiness([{ role: 'privacy', text: '   ' }]);
  assert.equal(none.ready, false);
  assert.match(none.reason, /no task in this run produced a deliverable/);

  assert.equal(composeReadiness(SOURCES).ready, true);
});
