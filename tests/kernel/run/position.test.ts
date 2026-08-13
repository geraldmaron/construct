/**
 * Construct's own read of what its roles found.
 *
 * The property under test is the line this module draws. A fact is something
 * Construct cannot know except through a role that read the ground, and
 * inventing one is fabrication. A judgment is what the facts add up to, and
 * nobody was dispatched to make it — so it is required, not permitted, and it
 * needs no source.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  collapseObjections,
  positionRepairIsAnImprovement,
  positionShortfalls,
  screenPosition,
  toPosition,
} from '../../../src/kernel/run/position.ts';

const ROLES = ['privacy', 'program-sequencing', 'product-scoping'];

const WHOLE = {
  approach: 'Do not fund a UGC discovery surface next; close the mobile launch gate first.',
  because: [
    { text: 'the compliance layer governs no live adapter', restsOn: ['product-scoping'] },
    { text: 'the mobile epic is stalled on one reconciliation', restsOn: ['program-sequencing'] },
  ],
  resolved: [
    {
      question: 'whether the kill switches still read from Firestore',
      took: ['product-scoping'],
      over: ['program-sequencing'],
      because: 'the wind-down document post-dates the sequencing note and reports the move done',
    },
  ],
  costs: [{ text: 'the image-sourcing lane slips a release', restsOn: ['product-scoping'] }],
  first: [{ text: 'reconcile the threat model', restsOn: ['program-sequencing'] }],
  strongestObjection: 'The compliance layer may be the cheaper unlock and it is already built.',
  preMortem: 'Mobile ships, nobody uses it, and the entity data was the real blocker.',
  undecided: [{ question: 'what the work costs', settledBy: 'a capacity document; none exists' }],
};

test('a whole position is read back intact', () => {
  const read = toPosition(WHOLE);

  assert.ok(read);
  assert.match(read.approach, /Do not fund a UGC discovery surface/);
  assert.equal(read.because.length, 2);
  assert.deepEqual(read.resolved[0].took, ['product-scoping']);
});

test('a reply with no call is not a position', () => {
  assert.equal(toPosition({ because: [{ text: 'x', restsOn: ['privacy'] }] }), null);
});

/**
 * The fabrication this design guards while it lets the judgment through: a
 * factual sentence with nothing behind it came from the composer's own
 * knowledge of the world, which it has no license to use.
 */
test('a factual claim resting on nobody is refused', () => {
  const screened = screenPosition(
    { ...toPosition(WHOLE)!, because: [{ text: 'Postgres is the system of record', restsOn: [] }] },
    ROLES,
  );

  assert.equal(screened.position.because.length, 0);
  assert.match(screened.refused[0].reason, /rests on no role/);
});

test('a claim resting on a role this run never dispatched is refused', () => {
  const screened = screenPosition(
    { ...toPosition(WHOLE)!, because: [{ text: 'x', restsOn: ['security'] }] },
    ROLES,
  );

  assert.match(screened.refused[0].reason, /produced no deliverable in this run/);
});

/**
 * Resolving is part of the job now — order of arrival was never a reason, and
 * reasoning is — but it may only settle a disagreement between roles that
 * actually ran.
 */
test('a resolution between roles that did not run is refused', () => {
  const screened = screenPosition(
    {
      ...toPosition(WHOLE)!,
      resolved: [{ question: 'q', took: ['legal'], over: ['privacy'], because: 'r' }],
    },
    ROLES,
  );

  assert.equal(screened.position.resolved.length, 0);
  assert.match(screened.refused[0].reason, /this run did not dispatch/);
});

test('a real resolution names the side it did not take and survives', () => {
  const screened = screenPosition(toPosition(WHOLE)!, ROLES);

  assert.equal(screened.position.resolved.length, 1);
  assert.deepEqual(screened.position.resolved[0].over, ['program-sequencing']);
  assert.deepEqual(screened.refused, []);
});

/**
 * Measured on a live composition: the ordinary shape of a disagreement is
 * several roles on one side and one holding out, and a model with a single-name
 * field writes a composite that names nobody. Refusing that refused sound work
 * for its punctuation.
 */
test('a side naming several roles is read as several roles', () => {
  const read = toPosition({
    ...WHOLE,
    resolved: [
      {
        question: 'whether to fund the UGC surface next',
        took: 'privacy + product-scoping',
        over: 'program-sequencing (which favored sequencing the mobile work first)',
        because: 'the wind-down document post-dates the sequencing note',
      },
    ],
  });

  assert.deepEqual(read!.resolved[0].took, ['privacy', 'product-scoping']);
  assert.deepEqual(read!.resolved[0].over, ['program-sequencing'], 'the gloss is not part of the name');
  assert.deepEqual(screenPosition(read!, ROLES).refused, []);
});

test('a side is kept for the roles that ran, and a stranger among them is dropped', () => {
  const screened = screenPosition(
    {
      ...toPosition(WHOLE)!,
      resolved: [
        {
          question: 'q',
          took: ['privacy', 'legal'],
          over: ['program-sequencing'],
          because: 'r',
        },
      ],
    },
    ROLES,
  );

  assert.deepEqual(screened.position.resolved[0].took, ['privacy'], 'legal never ran');
  assert.deepEqual(screened.refused, []);
});

test('a side left naming nobody the run dispatched is still refused whole', () => {
  const screened = screenPosition(
    {
      ...toPosition(WHOLE)!,
      resolved: [{ question: 'q', took: ['legal'], over: ['privacy'], because: 'r' }],
    },
    ROLES,
  );

  assert.equal(screened.position.resolved.length, 0);
  assert.match(screened.refused[0].reason, /this run did not dispatch \(legal\)/);
});

/**
 * A recommendation shipped without its strongest objection and its most likely
 * failure is an advertisement, and this system holds every role to exactly that
 * standard. Holding the synthesis to a lower one would invert it.
 */
test('a call arriving without the case against itself is reported short', () => {
  const short = positionShortfalls({
    ...toPosition(WHOLE)!,
    strongestObjection: '',
    preMortem: '',
  });

  assert.equal(short.length, 2);
  assert.match(short.join(' '), /strongest argument against/);
  assert.match(short.join(' '), /pre-mortem/);
});

test('a whole call owes nothing further', () => {
  assert.deepEqual(positionShortfalls(toPosition(WHOLE)!), []);
});

test('a call resting on nothing any role established is reported short', () => {
  assert.match(
    positionShortfalls({ ...toPosition(WHOLE)!, because: [] }).join(' '),
    /rests on nothing any role established/,
  );
});

/**
 * Three roles reaching for the same sentence is one contested sentence and the
 * strongest signal the objections carry. Printed three times it reads as three
 * problems and buries which sentence is actually in dispute.
 */
test('the same sentence quoted by several roles is one objection naming all of them', () => {
  const collapsed = collapseObjections([
    { role: 'privacy', quote: 'The kill switches are settled.' },
    { role: 'program-sequencing', quote: '  "the kill switches are settled."  ' },
    { role: 'product-scoping', quote: 'The mobile epic is stalled.' },
  ]);

  assert.equal(collapsed.length, 2);
  assert.deepEqual(collapsed[0].roles, ['privacy', 'program-sequencing']);
  assert.deepEqual(collapsed[1].roles, ['product-scoping']);
});

test('one role repeating itself is still one objection from one role', () => {
  const collapsed = collapseObjections([
    { role: 'privacy', quote: 'The kill switches are settled.' },
    { role: 'privacy', quote: 'The kill switches are settled.' },
  ]);

  assert.deepEqual(collapsed, [{ quote: 'The kill switches are settled.', roles: ['privacy'] }]);
});

const OBJECTION = { role: 'privacy', quote: 'The kill switches are settled.' };
const OTHER = { role: 'product-scoping', quote: 'The mobile epic is stalled.' };
const REFUSAL = { text: 'Postgres is the system of record', reason: 'rests on no role' };

/** Fixed something and broke nothing is a repair. */
test('a second call that drops an objection and adds nothing is taken', () => {
  assert.equal(
    positionRepairIsAnImprovement(
      { objections: [OBJECTION, OTHER], refused: [] },
      { objections: [OTHER], refused: [] },
    ),
    true,
  );
});

test('a second call that trades one objection for another is refused', () => {
  assert.equal(
    positionRepairIsAnImprovement(
      { objections: [OBJECTION], refused: [] },
      { objections: [OTHER], refused: [] },
    ),
    false,
  );
});

/**
 * The failure mode unique to this pass: a position is admitted claim by claim
 * on what it rests on, so a rewrite can answer an objection and lose the
 * attributions that made the call screenable at all.
 */
test('a second call that answers an objection by losing an attribution is refused', () => {
  assert.equal(
    positionRepairIsAnImprovement(
      { objections: [OBJECTION, OTHER], refused: [] },
      { objections: [OTHER], refused: [REFUSAL] },
    ),
    false,
  );
});

test('a refusal the first call already had is not held against the second', () => {
  assert.equal(
    positionRepairIsAnImprovement(
      { objections: [OBJECTION, OTHER], refused: [REFUSAL] },
      { objections: [OTHER], refused: [REFUSAL] },
    ),
    true,
  );
});

test('a second call that fixed nothing is refused rather than churned in', () => {
  assert.equal(
    positionRepairIsAnImprovement(
      { objections: [OBJECTION], refused: [] },
      { objections: [OBJECTION], refused: [] },
    ),
    false,
  );
});

test('a second call every role stopped objecting to is taken', () => {
  assert.equal(
    positionRepairIsAnImprovement(
      { objections: [OBJECTION, OTHER], refused: [] },
      { objections: [], refused: [] },
    ),
    true,
  );
});

/**
 * Measured on a live composition: a factual claim's restsOn survived with
 * "Product Scoping" where the real dispatched role is "product-scoping", and
 * the strict-equality check refused it as a role that never ran — the same
 * spelling-vs-identity failure fixed in compose.ts's screenComposition, at
 * this module's own equivalent call site.
 */
test('restsOn in a different case or spacing still resolves and is canonicalized', () => {
  const screened = screenPosition(
    { ...toPosition(WHOLE)!, because: [{ text: 'x', restsOn: ['Product Scoping', 'privacy_role'] }] },
    ['product-scoping', 'privacy_role', 'program-sequencing'],
  );
  assert.equal(screened.refused.length, 0);
  assert.deepEqual(screened.position.because[0]!.restsOn, ['product-scoping', 'privacy_role']);
});

test('a resolved side spelled differently than its dispatched role still resolves', () => {
  const screened = screenPosition(
    { ...toPosition(WHOLE)!, resolved: [{ question: 'q', took: ['Product Scoping'], over: ['Privacy'], because: 'r' }] },
    ROLES,
  );
  assert.deepEqual(screened.refused, []);
  assert.deepEqual(screened.position.resolved[0]!.took, ['product-scoping']);
  assert.deepEqual(screened.position.resolved[0]!.over, ['privacy']);
});

test('a document name or the composer\'s own role is still refused under any spelling', () => {
  const screened = screenPosition(
    { ...toPosition(WHOLE)!, because: [{ text: 'x', restsOn: ['AGENTS.MD', 'construct-position'] }] },
    ROLES,
  );
  assert.equal(screened.refused.length, 1);
  assert.match(screened.refused[0]!.reason, /produced no deliverable in this run/);
});
