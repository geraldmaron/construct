/**
 * Two roles describing one referent as being in two states.
 *
 * The regression case is real, from a composed document that shipped with both
 * sentences in it. Most of what follows is about what the check stays quiet
 * about: the cost of a miss is a contradiction the reader has to catch, and the
 * cost of a flood is a contradiction the reader stops looking for.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { contestedFacts, contestedLine } from '../../../src/kernel/run/contested.ts';

test('the kill-switch pair that shipped unreconciled is found', () => {
  const claims = [
    {
      from: 'program-sequencing',
      text:
        're-point any Firestore-backed switch to bb_ops.kill_switches before the ' +
        'beta-disable gate can be trusted',
    },
    {
      from: 'product-scoping',
      text: 'docs/data/firebase-wind-down.md shows kill switches already moved to bb_ops.kill_switches',
    },
  ];

  const found = contestedFacts(claims);

  assert.equal(found.length, 1);
  assert.equal(found[0].referent, 'bb_ops.kill_switches');
  assert.equal(found[0].pending.from, 'program-sequencing');
  assert.equal(found[0].completed.from, 'product-scoping');
  assert.match(contestedLine(found[0]), /only one of these is current/);
});

test('two roles discussing the same file without disagreeing are left alone', () => {
  const claims = [
    { from: 'privacy', text: 'docs/security/posture.md sets the living-person threshold at 0.9.' },
    { from: 'product-scoping', text: 'docs/security/posture.md is the source for the rights layer.' },
  ];

  assert.deepEqual(contestedFacts(claims), []);
});

/**
 * A role is allowed to disagree with itself across two sentences of its own
 * deliverable — that is a scope its own gates cover, and reporting it here
 * would be a second opinion about one role's internal consistency wearing the
 * shape of a cross-role conflict.
 */
test('one role saying both things is not a conflict between roles', () => {
  const claims = [
    { from: 'privacy', text: 'we must re-point the switches to bb_ops.kill_switches' },
    { from: 'privacy', text: 'the switches have already moved to bb_ops.kill_switches' },
  ];

  assert.deepEqual(contestedFacts(claims), []);
});

test('a claim describing a sequence does not contradict itself', () => {
  const claims = [
    {
      from: 'program-sequencing',
      text: 'the switches have already moved to bb_ops.kill_switches and must now be verified',
    },
    { from: 'privacy', text: 'bb_ops.kill_switches is no longer backed by Firestore' },
  ];

  assert.deepEqual(contestedFacts(claims), []);
});

test('a disagreement about nothing nameable is not reported', () => {
  const claims = [
    { from: 'privacy', text: 'the work still has to happen before launch' },
    { from: 'product-scoping', text: 'that work has already been done' },
  ];

  assert.deepEqual(contestedFacts(claims), []);
});

/**
 * One line per referent. A document where four claims touch the same table
 * needs the reader to know the table is contested, not to read six
 * combinations of one disagreement.
 */
test('a referent contested by several claims is reported once', () => {
  const claims = [
    { from: 'a', text: 'we must migrate bb_canonical.claims' },
    { from: 'b', text: 'bb_canonical.claims has already been migrated' },
    { from: 'c', text: 'bb_canonical.claims is now the system of record' },
  ];

  assert.equal(contestedFacts(claims).length, 1);
});
