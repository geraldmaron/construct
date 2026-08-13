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
      took: 'product-scoping',
      over: 'program-sequencing',
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
  assert.equal(read.resolved[0].took, 'product-scoping');
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
      resolved: [{ question: 'q', took: 'legal', over: 'privacy', because: 'r' }],
    },
    ROLES,
  );

  assert.equal(screened.position.resolved.length, 0);
  assert.match(screened.refused[0].reason, /this run did not dispatch/);
});

test('a real resolution names the side it did not take and survives', () => {
  const screened = screenPosition(toPosition(WHOLE)!, ROLES);

  assert.equal(screened.position.resolved.length, 1);
  assert.equal(screened.position.resolved[0].over, 'program-sequencing');
  assert.deepEqual(screened.refused, []);
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
