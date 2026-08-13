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
  standingLine,
  toComposition,
  unclearedSources,
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

/**
 * The screen a composed document shows is real and it is not the only one.
 *
 * A recorded run produced five deliverables, every one failing its citation
 * gate, none promoted — and the document composed from all five reported what
 * the composer had discarded, asserted that nothing was added by the composing,
 * and never mentioned that not one source had passed. Both statements were
 * true. Together they read as an assurance about the material that nobody made.
 */
test('sources that did not come through their own challenges are the ones reported', () => {
  const standings = [
    { role: 'privacy', state: 'draft', failing: ['claims-cited'], outstanding: ['legal-issue-spot'], repaired: [] },
    { role: 'product-scoping', state: 'challenged', failing: ['claims-cited'], outstanding: [], repaired: [] },
    { role: 'measurement', state: 'promoted', failing: [], outstanding: [], repaired: [] },
  ];

  const uncleared = unclearedSources(standings);

  assert.deepEqual(uncleared.map((s) => s.role), ['privacy', 'product-scoping']);
});

test('a run whose every source is clean reports nothing, rather than reporting cleanliness', () => {
  const clean = [
    { role: 'privacy', state: 'promoted', failing: [], outstanding: [], repaired: [] },
    { role: 'security', state: 'promoted', failing: [], outstanding: [], repaired: [] },
  ];

  assert.deepEqual(unclearedSources(clean), []);
});

test('an outstanding challenge is reported as answered by nobody, not as passed', () => {
  const line = standingLine({
    role: 'privacy',
    state: 'draft',
    failing: ['claims-cited'],
    outstanding: ['legal-issue-spot'], repaired: [],
  });

  assert.match(line, /failed claims-cited/);
  assert.match(line, /legal-issue-spot answered by nobody/);
});

/**
 * The repair round finishes work the checks found unfinished, and a run that
 * repaired every source to green would otherwise compose a document reporting
 * nothing — a stronger assurance than the un-repaired run gave, bought by the
 * run correcting itself. Passing on the second attempt is a fact about the
 * document and belongs where the other standing facts are.
 */
test('a source that only passed after being sent back is reported, not counted as clean', () => {
  const standings = [
    { role: 'privacy', state: 'challenged', failing: [], outstanding: [], repaired: ['ground-exhausted'] },
    { role: 'measurement', state: 'promoted', failing: [], outstanding: [], repaired: [] },
  ];

  assert.deepEqual(unclearedSources(standings).map((s) => s.role), ['privacy']);
  assert.match(
    standingLine(standings[0]),
    /passed ground-exhausted only after being sent back/,
  );
});

/**
 * Measured on three live compositions on a free model in one session: two
 * came back with zero claims kept because the model wrote a real dispatched
 * role's name in a form the discard check did not recognize — "Product
 * Scoping" for "product-scoping" — and the whole document was lost to a
 * spelling mismatch the guard was never meant to enforce. It was still right
 * to refuse "author" and "construct-position" (a document byline and
 * Construct's own internal role id, neither ever dispatched); the fix is
 * lenient about form and exactly as strict about identity.
 */
test('a role name in a different case or spacing still resolves to the real role', () => {
  const composition = toComposition({
    claims: [
      { section: 'the-answer', text: 'kept via title case', from: 'Product Scoping' },
      { section: 'what-follows', text: 'kept via underscore', from: 'strategy_alignment' },
    ],
    uncovered: [],
  });
  const screened = screenComposition(composition, SOURCES);
  assert.equal(screened.discarded.length, 0, 'neither claim should be refused for its spelling');
  // Canonicalized to the real id, not left as the model spelled it — so every
  // downstream reader (the support check, the rendered attribution) sees one
  // consistent identifier regardless of how the model wrote it.
  assert.deepEqual(
    screened.claims.map((c) => c.from),
    ['product-scoping', 'strategy-alignment'],
  );
});

test('a genuinely invented source is still refused under any spelling', () => {
  const composition = toComposition({
    claims: [
      { section: 'the-answer', text: 'from a document byline, not a role', from: 'author' },
      { section: 'what-follows', text: 'from the composer\'s own internal id', from: 'construct-position' },
    ],
    uncovered: [],
  });
  const screened = screenComposition(composition, SOURCES);
  assert.equal(screened.claims.length, 0);
  assert.equal(screened.discarded.length, 2);
});
