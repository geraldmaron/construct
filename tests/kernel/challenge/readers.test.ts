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
  namesAnOwnerIn,
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
 * The recorded second failure, and the one the slot reading exists for.
 *
 * A strategy review said in its own decision-owner slot that no owner was named,
 * raised an ASK for exactly that, and passed the gate. The text below is that
 * deliverable's shape: the slot as it was written, and the two sentences
 * elsewhere that a whole-document read counted as owner attributions. One of
 * them is the sentence reporting that no owner was named.
 */
const NO_DECISION_OWNER_NAMED =
  '## price\n\n' +
  'Not stated as a dollar or time figure anywhere in the material.\n\n' +
  '## decision-owner\n\n' +
  'Not named in the material as a single role or person for "what capability to fund next." ' +
  '`docs/data/firebase-wind-down.md` names an "owner" only for specific console-level actions ' +
  '(Supabase dashboard toggle, admin decommission) — a different, narrower decision than the one ' +
  'this outcome asks for. Treat this as asking the decision owner to decide, once named.\n\n' +
  '## displaced-work\n\n' +
  '- Firebase wind-down completion: the open items are pre-existing, already-scoped work.\n\n' +
  '## rubric-strategy-alignment-S3\n\n' +
  'Decision owner is not named for the roadmap-commitment question itself (see decision-owner ' +
  'above); a narrower owner is named only for specific Firebase console actions.\n';

test('a deliverable that says in its own slot that no owner is named does not pass the owner gate', () => {
  const s3 = RUBRIC_LINES.find((line) => line.id === 'S3');
  assert.equal(s3?.enforcement.kind, 'structural');

  const check = (s3?.enforcement as { check: (d: string) => { passed: boolean; detail: string } })
    .check(NO_DECISION_OWNER_NAMED);

  assert.equal(check.passed, false);
  assert.match(check.detail, /placeholder/);
});

/**
 * The narrower reading is the whole correction: an owner named for something
 * else is not an answer to this line, and a whole-document read cannot tell the
 * difference. The slot the template asked the question in can.
 */
test('an owner named for a different, narrower decision does not answer the decision-owner line', () => {
  const namedElsewhere =
    '## decision-owner\n\nNot named in the material.\n\n' +
    '## displaced-work\n\nOwner: D. Okafor, for the console decommission steps only.\n';

  assert.equal(namesAnOwnerIn('decision-owner')(namedElsewhere).passed, false);
  // The same text passes the reading that cannot ask which decision is owned,
  // which is why the lines gate on the narrower one.
  assert.equal(namesAnOwner(namedElsewhere).passed, true);
});

test('a placeholder that explains itself past the end of the phrase is still a placeholder', () => {
  for (const written of [
    'Not named in the material as a single role or person for what to fund next.',
    'Not yet assigned; the research lead would be the natural owner once staffed.',
    'To be determined at the next planning review.',
    'No single named owner exists in the read material.',
    'Unowned as of this writing — security/platform admin is the likely home.',
  ]) {
    const check = namesAnOwnerIn('decision-owner')(`## decision-owner\n\n${written}\n`);
    assert.equal(check.passed, false, `should read as a placeholder: ${written}`);
  }
});

test('"the team" is not an owner however the slot phrases it, but a narrowed collective is', () => {
  const collective = namesAnOwnerIn('ownership')('## ownership\n\nThe team owns this when it breaks.\n');
  assert.equal(collective.passed, false);

  const narrowed = namesAnOwnerIn('ownership')('## ownership\n\nThe team lead, D. Okafor, is paged.\n');
  assert.equal(narrowed.passed, true);
});

test('a name in the slot passes, in the forms a role writes it', () => {
  for (const written of [
    '## decision-owner\n\nD. Okafor, VP Engineering, is being asked to decide.\n',
    '## decision-owner\n\n**Decision owner:** the platform security lead (D. Okafor) — asked to decide.\n',
    'Decision owner: D. Okafor, who is being informed rather than asked.\n',
  ]) {
    assert.equal(namesAnOwnerIn('decision-owner')(written).passed, true, `should read a name from: ${written}`);
  }
});

/**
 * A deliverable that ignores the template is not held to a standard the
 * template implies: the missing slot is a gap the ladder already raises, and
 * this check is meant to be stricter than the whole-document read, not scoped
 * somewhere the deliverable never wrote.
 */
test('a deliverable that never heads the slot falls back to the whole-document reading', () => {
  const unheaded = '## finding\n\nProceed with the migration. Owner: D. Okafor.\n';

  assert.equal(namesAnOwnerIn('decision-owner')(unheaded).passed, true);
  assert.equal(namesAnOwnerIn('decision-owner')('## finding\n\nProceed.\n').passed, false);
});

/**
 * The second real deliverable this gate met, and the hole it found.
 *
 * The placeholder openings catch a slot that begins by refusing the question.
 * This one began by describing the material — "The material names no product
 * owner distinct from the engineering function" — which is the same non-answer
 * with a subject in front of it, and an anchored test cannot see it. The
 * deliverable went on to say honestly that it was asking that unnamed person to
 * decide, which is the ladder working; the gate passing it was not.
 */
test('a slot that says the material names no owner has not named one', () => {
  const asWritten =
    '## decision-owner\n\n' +
    'The material names no product owner distinct from the engineering function; ' +
    'docs/runbooks/solo-dev-hotfix.md describes a solo-developer release pattern. ' +
    'This outcome is asking that person to decide now, not informing them.\n';

  const check = namesAnOwnerIn('decision-owner')(asWritten);

  assert.equal(check.passed, false);
  assert.match(check.detail, /placeholder/);
});

test('a denial of ownership is read wherever it sits, but a negative about a named person is not', () => {
  const denied = [
    'There is no owner for this call in the material.',
    'Engineering leadership has no single named owner for funding decisions.',
    'Nobody in the read material owns what capability is funded next.',
  ];
  for (const written of denied) {
    assert.equal(
      namesAnOwnerIn('decision-owner')(`## decision-owner\n\n${written}\n`).passed,
      false,
      `should read as a denial: ${written}`,
    );
  }

  // The distinction the rule has to keep: a named person described with a
  // negative clause is still a named person.
  assert.equal(
    namesAnOwnerIn('decision-owner')(
      '## decision-owner\n\nD. Okafor, who is not on call this week, is being asked to decide.\n',
    ).passed,
    true,
  );
});

test('a head long enough to be prose is prose, and an honest role title is not', () => {
  const prose =
    '## decision-owner\n\nWhoever sets product direction across the mobile epic and the ' +
    'discovery lane would have to weigh these against each other before anything ships.\n';
  assert.equal(namesAnOwnerIn('decision-owner')(prose).passed, false);

  const title = '## decision-owner\n\nThe head of trust and safety for the Americas region.\n';
  assert.equal(namesAnOwnerIn('decision-owner')(title).passed, true);
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
