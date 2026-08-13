/**
 * The round that sends unfinished work back.
 *
 * What these tests hold is the instruction, because the instruction is the
 * whole mechanism: the round is one host call, and everything that decides
 * whether the second attempt is real work or relabelling is in the text the
 * role receives.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { repairAssignment, repairableFailures } from '../../../src/kernel/run/repair.ts';

const FAILED_GROUND = {
  challenge: 'ground-exhausted',
  passed: false,
  detail: '2 document(s) are named but never cited: docs/a.md, docs/b.md',
};
const FAILED_CITES = {
  challenge: 'claims-cited',
  passed: false,
  detail: '3 claim(s) carry neither a citation nor an [unverified] tag: line 6',
};
const PASSED = { challenge: 'scope-diff', passed: true, detail: 'present' };

test('only the failures go back', () => {
  assert.deepEqual(
    repairableFailures([FAILED_GROUND, PASSED, FAILED_CITES]).map((f) => f.challenge),
    ['ground-exhausted', 'claims-cited'],
  );
});

test('a deliverable that passed everything is never sent back', () => {
  assert.deepEqual(repairableFailures([PASSED]), []);
});

/**
 * Every one of these checks can be passed without doing anything: tag the claim
 * rather than source it, write "could not be read" over a file nobody opened,
 * add the heading and leave it empty. A repair round that did not name the
 * cheap fix would buy a green gate and no work, which is worse than the red
 * gate it replaced because the reader now believes it.
 */
test('the cheap way to pass each failing check is named and refused', () => {
  const text = repairAssignment({
    role: 'privacy',
    deliverable: 'draft body',
    failures: [FAILED_CITES, FAILED_GROUND],
  });

  assert.match(text, /Do not close this by: Tagging a claim \[unverified\]/);
  assert.match(text, /never tried to open it/);
});

test('the whole deliverable is asked for, not the missing piece', () => {
  const text = repairAssignment({
    role: 'privacy',
    deliverable: 'draft body',
    failures: [FAILED_GROUND],
  });

  assert.match(text, /send back the whole deliverable/);
  assert.match(text, /Not a patch/);
});

/**
 * The license is restated because the most common reason a draft comes back is
 * a file the role named and did not open, and a role that has just been told it
 * fell short is the one most likely to assume its reading was closed.
 */
test('a grounded repair restates the roots the role may still read', () => {
  const text = repairAssignment({
    role: 'privacy',
    deliverable: 'draft body',
    failures: [FAILED_GROUND],
    groundRoots: ['/repo', '/notes'],
  });

  assert.match(text, /- \/repo/);
  assert.match(text, /- \/notes/);
  assert.match(text, /same license you held the first time/);
});

test('an ungrounded repair claims no license it was not given', () => {
  const text = repairAssignment({
    role: 'privacy',
    deliverable: 'draft body',
    failures: [FAILED_CITES],
  });

  assert.doesNotMatch(text, /license/i);
});

/**
 * One round. The role is told so, because a role that expects another pass
 * spends this one on the cheapest half.
 */
test('the role is told this is the only time it comes back', () => {
  const text = repairAssignment({
    role: 'privacy',
    deliverable: 'draft body',
    failures: [FAILED_CITES],
  });

  assert.match(text, /only time it comes back/);
  assert.match(text, /goes to the reader as it stands/);
});

test('a reader-rubric failure reaches the cheap-fix table through its namespace', () => {
  const text = repairAssignment({
    role: 'strategy-alignment',
    deliverable: 'draft body',
    failures: [
      {
        challenge: 'rubric-strategy-alignment-S3',
        passed: false,
        detail: 'no owner named in the decision-owner slot',
      },
    ],
  });

  assert.match(text, /Do not close this by: Prose about the thing the line asks for/);
});
