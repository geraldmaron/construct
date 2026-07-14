/**
 * tests/orchestration-revise-loop.test.mjs — construct-72gqn.30 (D10).
 *
 * Unit coverage for the critic/reviser loop's two pure decisions: whether a
 * critic's output requests a revision at all (critiqueRequestsRevision), and the
 * measured adopt/no-adopt go/no-go that gates turning the loop on for a workload
 * (scoreReviseLoop). The loop's runtime wiring is exercised end to end in
 * tests/functional/orchestration-revise-loop.functional.test.mjs.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { critiqueRequestsRevision } from '../lib/orchestration/runtime.mjs';
import { scoreReviseLoop } from '../lib/orchestration/revise-loop-measure.mjs';

test('critiqueRequestsRevision fires only when the critic asked for changes, not on approval', () => {
  assert.equal(critiqueRequestsRevision('APPROVED. Ship it.'), false);
  assert.equal(critiqueRequestsRevision('Looks good — one minor nit, but approved.'), false);
  assert.equal(critiqueRequestsRevision('No blocking issues found.'), false);
  assert.equal(critiqueRequestsRevision(''), false);
  assert.equal(critiqueRequestsRevision(null), false);
  assert.equal(critiqueRequestsRevision('CHANGES_REQUESTED: must fix the auth flow.'), true);
  assert.equal(critiqueRequestsRevision('This needs work before it can merge — the error handling is missing.'), true);
  assert.equal(critiqueRequestsRevision('Rejected: revise the interface contract.'), true);
});

test('critiqueRequestsRevision recognizes the vocabulary real structured reviews use (construct-72gqn.30 live finding)', () => {
  // A live gpt-4o-mini review of insecure code flagged a HIGH issue with a fix
  // directive but never said "changes requested" — the loop must still fire.
  assert.equal(critiqueRequestsRevision('# Code Review\n### SEVERITY HIGH | lib/x.js:9 | ISSUE: Missing input validation | RECOMMENDED FIX: implement validation.'), true);
  assert.equal(critiqueRequestsRevision('There are no tests implemented, which is a critical gap.'), true);
  assert.equal(critiqueRequestsRevision('The endpoint has a SQL injection vulnerability that must be addressed.'), true);
  assert.equal(critiqueRequestsRevision('Overall the structure looks good, but SEVERITY HIGH: the API key is not validated.'), true);
  // The same model emits the same finding as JSON on another run — must still fire.
  assert.equal(critiqueRequestsRevision('{ "findings": [ { "severity": "CRITICAL", "issue": "Absence of input validation", "recommendedFix": "Implement it" } ] }'), true);
  // A low-severity nit with an approval must NOT fire.
  assert.equal(critiqueRequestsRevision('SEVERITY LOW: consider renaming a variable. Otherwise APPROVED.'), false);
  assert.equal(critiqueRequestsRevision('No high-severity issues; APPROVED.'), false);
});

const engineerTask = (output) => ({ role: 'cx-engineer', status: 'done', output });
const reviewerTask = (output) => ({ role: 'cx-reviewer', status: 'done', output });

test('scoreReviseLoop adopts the loop only when the revised artifact covers more role concerns', () => {
  const baseRun = { tasks: [engineerTask('Implemented the login function.')] };
  const loopRun = {
    revisionRounds: 1,
    tasks: [
      engineerTask('Implemented the login function.'),
      reviewerTask('CHANGES_REQUESTED: no tests, no edge cases.'),
      engineerTask('Refactored the module with a design decision trade-off; added test coverage and handled the edge case failure mode.'),
    ],
  };
  const r = scoreReviseLoop({ baseRun, loopRun });
  assert.equal(r.adopt, true);
  assert.equal(r.verdict, 'adopt-revise-loop');
  assert.ok(r.coverageDelta > 0, `expected positive coverage delta, got ${r.coverageDelta}`);
  assert.equal(r.loop.revisionRounds, 1);
  assert.match(r.rationale, /role concern/);
});

test('scoreReviseLoop declines the loop when the extra rounds add no measured gain', () => {
  const same = 'Implemented the login function.';
  const baseRun = { tasks: [engineerTask(same)] };
  const loopRun = { revisionRounds: 2, tasks: [engineerTask(same), reviewerTask('CHANGES_REQUESTED'), engineerTask(same)] };
  const r = scoreReviseLoop({ baseRun, loopRun });
  assert.equal(r.adopt, false);
  assert.equal(r.verdict, 'no-adopt-revise-loop-no-measured-gain');
  assert.equal(r.coverageDelta, 0);
  assert.match(r.rationale, /no role-concern gain|not worth/);
});

test('scoreReviseLoop scores the final producer artifact, not the critic commentary', () => {
  // The critic output is full of concern keywords; it must not be what gets scored —
  // only the last non-critic (producer) output counts as the shipped artifact.
  const loopRun = {
    revisionRounds: 1,
    tasks: [
      engineerTask('Did the thing.'),
      reviewerTask('trade-off invariant edge case failure mode test coverage assert regression'),
      engineerTask('Did the thing, now with an assert.'),
    ],
  };
  const r = scoreReviseLoop({ baseRun: { tasks: [engineerTask('Did the thing.')] }, loopRun });
  // The producer's revised output covers only `testing` (assert), not the four
  // concerns the reviewer text mentions.
  assert.ok(r.loop.coverage.count <= 2, `producer artifact scored, not critic text (got ${r.loop.coverage.count})`);
});
