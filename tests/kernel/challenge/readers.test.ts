/**
 * tests/kernel/challenge/personas.test.ts — the reader's standard, held to.
 *
 * The case that matters most is the recorded one. A strategy document was
 * produced that cited every claim, recorded every refusal, and named every gap
 * it had left — and marked every recommendation it made `[unowned]`. It was
 * well-built and unusable: the reader it was written for cannot act on a
 * recommendation with nobody's name against it, which the acceptance rubric had
 * said in as many words for weeks before that run. The first test below is that
 * document's own shape, and it must fail.
 *
 * The rest guard the two ways this stops meaning anything. A check that passes
 * on a placeholder turns "name an owner" into "write the word owner", and a
 * check applied to a concern whose reader never asked for it holds a deliverable
 * to a standard the rubric does not contain.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RUBRIC_LINES,
  namesAnOwner,
  rubricChallengeId,
  rubricFor,
  structuralRubricFor,
} from '../../../src/kernel/challenge/readers.ts';
import { challengeById } from '../../../src/kernel/challenge/catalog.ts';
import { startRun } from '../../../src/kernel/run/outcome.ts';
import { sterile } from '../../harness/sterile.ts';
import { openStore } from '../../../src/kernel/store/open.ts';
import { listTasks } from '../../../src/kernel/store/tasks.ts';
import { join } from 'node:path';

const AT = '2026-08-13T00:00:00.000Z';

test('the recorded failure fails: every recommendation marked unowned names no owner', () => {
  const asShipped =
    '## what-follows\n' +
    '- Close the assertRecentReauth gap on canonical merges before further investment. Owner: [unowned]\n' +
    '- Reconcile the stale deployment documentation against current state. Owner: [unowned]\n' +
    '- Confirm the capture-completeness percentage against the 95% bar. Owner: [unowned]\n';

  const check = namesAnOwner(asShipped);

  assert.equal(check.passed, false);
  assert.match(check.detail, /placeholder/);
  assert.match(check.detail, /unowned/);
});

/**
 * The form the real deliverable used, which an earlier version of this check
 * passed. Every line is honest and useful and none of them is a name: the
 * reader is told what kind of person would own each item and is left with a
 * search. Whatever follows the placeholder explains it rather than replacing it.
 */
test('an explained placeholder is still a placeholder', () => {
  const asWritten = [
    'Owner: [unowned]; closing it is a security/platform-admin call given it concerns session reauth.',
    'Owner: [unowned] — research/product lead who sets the discovery roadmap.',
    'Owner: [unowned] — security/platform admin owns assertRecentReauth; product owns the second approver.',
    'Owner: [unowned] — owner of docs/admin/ content.',
  ].join('\n');

  const check = namesAnOwner(asWritten);

  assert.equal(check.passed, false);
  assert.match(check.detail, /placeholder/);
});

test('a name followed by qualifying prose is still a name', () => {
  const check = namesAnOwner('Owner: D. Okafor — with the release manager as backup while she is on leave.');

  assert.equal(check.passed, true);
});

test('"the team" is not an owner, because the rubric says so outright', () => {
  const check = namesAnOwner('The rollback is owned by the team, who will action it on detection.');

  assert.equal(check.passed, false);
  assert.match(check.detail, /placeholder/);
});

test('a deliverable that names nobody at all fails differently from one that names a placeholder', () => {
  const silent = namesAnOwner('The reauth gap should close before the next release ships.');

  assert.equal(silent.passed, false);
  assert.match(silent.detail, /no owner is named/);
});

test('a named owner passes, and the check says what it cannot see', () => {
  const check = namesAnOwner('Owner: the platform security lead (D. Okafor), who is being asked to decide.');

  assert.equal(check.passed, true);
  assert.match(check.detail, /cannot answer/);
});

test('the several forms a role writes an owner in are all owners', () => {
  for (const text of [
    'Owner: D. Okafor',
    '- decision owner — the VP of Engineering',
    'This is [owner: the release manager] to decide.',
    'The detection path is owned by the on-call SRE.',
    'The owner is the data platform lead.',
  ]) {
    assert.equal(namesAnOwner(text).passed, true, `should read an owner from: ${text}`);
  }
});

/**
 * The binding is per concern, which is the whole point: a requirement that
 * applies to one reader and not another is declared on that reader's concern or
 * it is not a requirement.
 */
test('rubric lines bind only to the concern the document keys them to', () => {
  assert.ok(rubricFor('strategy-alignment').some((line) => line.id === 'S3'));
  assert.equal(rubricFor('strategy-alignment').some((line) => line.id === 'O2'), false);
  assert.equal(rubricFor('privacy').length, 0, 'privacy has no concern-keyed rubric section');
});

test('only must-lines with a structural form become free gates', () => {
  for (const line of structuralRubricFor('strategy-alignment')) {
    assert.equal(line.weight, 'must');
    assert.equal(line.enforcement.kind, 'structural');
  }
  // S1 states a requirement no presence test can carry, and is marked as such
  // rather than gated on a matcher that would admit the failure the rubric
  // names by name.
  const s1 = RUBRIC_LINES.find((line) => line.id === 'S1');
  assert.equal(s1?.enforcement.kind, 'judgment');
  assert.ok((s1?.enforcement as { why: string }).why.length > 0);
});

test('every rubric line with a structural form is reachable as a challenge by id', () => {
  for (const line of RUBRIC_LINES) {
    if (line.enforcement.kind !== 'structural' || line.weight !== 'must') continue;
    const challenge = challengeById(rubricChallengeId(line));
    assert.ok(challenge, `${rubricChallengeId(line)} should be a challenge`);
    assert.equal(challenge?.question, line.requires);
    assert.ok(challenge?.structural, 'a structural line must carry its checker');
  }
});

test('a judgment-only line is never registered as a free challenge that could pass', () => {
  for (const line of RUBRIC_LINES) {
    if (line.enforcement.kind !== 'judgment') continue;
    assert.equal(
      challengeById(rubricChallengeId(line)),
      undefined,
      `${rubricChallengeId(line)} needs a judging pass and must not read as checkable`,
    );
  }
});

test("a strategy brief declares its reader's acceptance lines, and another concern's do not leak in", () => {
  const fixture = sterile();
  try {
    const store = openStore(join(fixture.root, 'store.db'));
    const run = startRun(store, {
      runId: 'run-rubric',
      outcome: 'Decide the strategy for the next two releases: which bet we invest in and what we stop doing to pay for it',
      at: AT,
    });
    assert.ok(run.implicated.some((i) => i.domain === 'strategy-alignment'));

    const strategy = listTasks(store, 'run-rubric').find((t) => t.role === 'strategy-alignment');
    const declared = (strategy?.brief as { challenges?: string[] }).challenges ?? [];
    assert.ok(
      declared.includes('rubric-strategy-alignment-S3'),
      'the director who reads this requires a named decision owner',
    );
    assert.equal(
      declared.some((id) => id.startsWith('rubric-operations-')),
      false,
      "another concern's reader does not get to set this one's bar",
    );
  } finally {
    fixture.cleanup();
  }
});
