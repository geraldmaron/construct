/**
 * tests/kernel/challenge/catalog.test.ts — the challenge contract, and the
 * line between what a free check can settle and what it cannot.
 *
 * The assertions that matter most are the negative ones. A declared challenge
 * with no structural form is never recorded as passed, because a control
 * satisfied by nobody looking is worse than no control: the brief still reads
 * as if the deliverable was challenged. And a structural pass claims only that
 * the work was shown, never that it was good — the moment a presence test is
 * reported as a judgement, the promotion state stops meaning what commitment
 * 13 says it means.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { sterile } from '../../harness/sterile.ts';
import { openStore } from '../../../src/kernel/store/open.ts';
import { enqueueTask } from '../../../src/kernel/store/tasks.ts';
import { readWorkLog } from '../../../src/kernel/store/worklog.ts';
import { promotionOf } from '../../../src/kernel/run/promotion.ts';
import { workRun, assignmentFor } from '../../../src/kernel/run/coordinator.ts';
import {
  CHALLENGES,
  challengeById,
  runStructuralChallenges,
} from '../../../src/kernel/challenge/catalog.ts';
import type { Brief } from '../../../src/kernel/brief/schema.ts';
import type { HostAdapter, HostResult } from '../../../src/kernel/hosts/interface.ts';

const AT = '2026-08-05T00:00:00.000Z';

function brief(challenges: readonly string[]): Brief {
  return {
    id: 't-privacy',
    outcome: 'Launch a paid beta to EU users',
    role: 'privacy',
    inputs: [],
    capabilities: [],
    postconditions: [],
    challenges,
  };
}

const GOOD = [
  '# Privacy read',
  'The launch needs a lawful basis before the first EU user.',
  '',
  '## Strongest objection',
  'A reasonable person would argue the beta is small enough to rely on consent.',
  '',
  '## Pre-mortem',
  'Assume this failed: deletion was never wired, and the first erasure request took three weeks.',
  '',
  'A breach must be reported within 72 hours [cite:GDPR Article 33(1)].',
  '',
  '## Out of scope',
  'I could not determine where the data is processed, so transfers are uncovered.',
].join('\n');

/** The same work, with nothing shown and one untagged number. */
const THIN = [
  '# Privacy read',
  'This is fine. Ship it.',
  'Churn is under 4% so the risk is low.',
].join('\n');

test('a structural check finds work that was shown and misses work that was not', () => {
  const declared = ['strongest-objection', 'pre-mortem', 'claims-cited', 'scope-diff'];

  const good = runStructuralChallenges(brief(declared), GOOD);
  assert.deepEqual(good.unanswered, []);
  assert.deepEqual(
    good.results.filter((r) => !r.passed),
    [],
    `everything shown should pass: ${JSON.stringify(good.results)}`,
  );

  const thin = runStructuralChallenges(brief(declared), THIN);
  assert.deepEqual(thin.results.map((r) => r.passed), [false, false, false, false]);
  // The failure says what was looked for, so the role can fix it rather than guess.
  assert.match(thin.results[0].detail, /labelled strongest objection: not found/);
  const cited = thin.results.find((r) => r.challenge === 'claims-cited');
  assert.ok(cited);
  assert.match(cited.detail, /neither a citation nor an \[unverified\] tag/);
});

test('a challenge with no structural form is left unanswered, never passed', () => {
  const run = runStructuralChallenges(brief(['legal-issue-spot', 'not-a-challenge']), GOOD);
  assert.deepEqual(run.results, [], 'nothing may be recorded for a challenge nothing can check');
  assert.deepEqual(run.unanswered.map((u) => u.challenge), ['legal-issue-spot', 'not-a-challenge']);
  assert.match(run.unanswered[0].reason, /substantive pass/);
  assert.match(run.unanswered[1].reason, /stays unanswered rather than passing by default/);
});

test('a structural pass claims presence, not quality', () => {
  const run = runStructuralChallenges(brief(['strongest-objection']), GOOD);
  // The detail is what a reader sees next to a passing verdict, and it must
  // not let a presence test read as a judgement.
  assert.match(run.results[0].detail, /whether it is genuinely the strongest is a substantive question/);
});

test('the citation challenge reuses the existing checker rather than a second matcher', () => {
  const cited = challengeById('claims-cited');
  assert.ok(cited?.structural);
  const check = cited.structural;
  // The notation is verify/claims.ts's, and the voice teaches the same one.
  assert.equal(check('Churn rose 4% [cite:billing export].', brief([])).passed, true);
  assert.equal(check('Churn rose 4%.', brief([])).passed, false);
  assert.equal(check('Churn rose 4% [unverified].', brief([])).passed, true);
});

test('the role is told which challenges it will be held to, before it writes', () => {
  const assignment = assignmentFor(brief(['strongest-objection', 'legal-issue-spot']));
  assert.match(assignment, /must satisfy the challenges/);
  const objection = challengeById('strongest-objection');
  const legal = challengeById('legal-issue-spot');
  assert.ok(objection && legal);
  assert.ok(assignment.includes(objection.question));
  // Including the ones no free check can settle: the role still has to do them.
  assert.ok(assignment.includes(legal.question));

  // A brief that declares none says nothing, rather than describing an empty contract.
  assert.doesNotMatch(assignmentFor(brief([])), /must satisfy the challenges/);
});

test('checks run at dispatch, and their verdicts drive promotion without a second path', async () => {
  await (async () => {
    const fixture = sterile();
    const store = openStore(join(fixture.paths.dataDir, 'construct.db'));
    try {
      const declared = ['strongest-objection', 'claims-cited', 'legal-issue-spot'];
      enqueueTask(store, {
        id: 't-privacy',
        run: 'run-1',
        role: 'privacy',
        brief: brief(declared),
        at: AT,
      });

      const host = {
        name: 'fake',
        kind: 'general',
        capabilities: ['concurrent'],
        init: async (): Promise<void> => {},
        health: async () => ({ live: true }),
        cancel: async () => ({ cancelled: false }),
        invoke: async (): Promise<HostResult> => ({
          id: 't-privacy',
          status: 'ok',
          output: { text: GOOD, usage: { cost: 0, steps: 1 } },
          error: null,
        }),
      } as unknown as HostAdapter;

      await workRun(store, host, { owner: 'w1', clock: () => AT, spendCeiling: 100 });

      const promotion = promotionOf(store, 't-privacy');
      assert.ok(promotion);

      // Two of the three were answered for free, and both passed. The verdicts
      // are read off the same append-only log promotion derives from — there is
      // no second record of a challenge outcome.
      const answered = readWorkLog(store, 'run-1')
        .filter((e) => e.action === 'verdict-recorded')
        .map((e) => e.detail as { challenge: string; outcome: string; by: string });
      assert.deepEqual(
        answered.map((v) => `${v.challenge}:${v.outcome}`).sort(),
        ['claims-cited:passed', 'strongest-objection:passed'],
      );
      assert.ok(answered.every((v) => v.by === 'construct:structural'));

      // The third had no free form, so the deliverable does not promote on the
      // strength of the two that did.
      assert.equal(promotion.state, 'draft');
      assert.deepEqual(promotion.outstanding, ['legal-issue-spot']);
      const unanswered = readWorkLog(store, 'run-1').filter(
        (e) => e.action === 'challenge-unanswered',
      );
      assert.equal(unanswered.length, 1);
      assert.deepEqual(
        (unanswered[0].detail as { unanswered: Array<{ challenge: string }> }).unanswered.map(
          (u) => u.challenge,
        ),
        ['legal-issue-spot'],
      );
    } finally {
      store.close();
      fixture.cleanup();
    }
  })();
});

test('every catalogued challenge states its question, and ids are unique', () => {
  const ids = CHALLENGES.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const challenge of CHALLENGES) {
    assert.ok(challenge.question.endsWith('?'), `${challenge.id} must ask something`);
  }
});

test('compliance prose with no marker anywhere fails claims-cited: attesting is not citing', () => {
  const attested = [
    '# Review',
    'Hiring in Poland requires an employment agreement under local labor law.',
    '## Claims cited',
    'Every claim above is either supported by the outcome or marked [unverified].',
    '## Out of scope',
    'Payroll setup is not covered.',
  ].join('\n');
  const run = runStructuralChallenges(brief(['claims-cited']), attested);
  const check = run.results.find((r) => r.challenge === 'claims-cited');
  assert.equal(check?.passed, false);
  assert.match(check?.detail ?? '', /compliance prose is not compliance/);

  // One real marker on a working line is the practice, and the pass returns.
  const practiced = attested + '\nLocal law requires a written agreement [unverified].';
  const good = runStructuralChallenges(brief(['claims-cited']), practiced);
  assert.equal(good.results.find((r) => r.challenge === 'claims-cited')?.passed, true);
});

test('a scope-diff that invents what the brief asked for fails against the recorded outcome', () => {
  // brief() records the outcome 'Launch a paid beta to EU users'.
  const fabricated = [
    'The brief asked for a hiring roadmap covering contractors.',
    '## Out of scope',
    'Vendor selection is not covered.',
  ].join('\n');
  const run = runStructuralChallenges(brief(['scope-diff']), fabricated);
  const check = run.results.find((r) => r.challenge === 'scope-diff');
  assert.equal(check?.passed, false);
  assert.match(check?.detail ?? '', /recorded outcome/);

  // A paraphrase anchored in the record survives: "beta" appears in the outcome.
  const anchored = [
    'The brief asked for a beta launch in the EU.',
    '## Out of scope',
    'Pricing is not covered.',
  ].join('\n');
  const ok = runStructuralChallenges(brief(['scope-diff']), anchored);
  assert.equal(ok.results.find((r) => r.challenge === 'scope-diff')?.passed, true);
});

test('claims-cited judges code citations against the ground roots the run was licensed', () => {
  const cited = challengeById('claims-cited');
  assert.ok(cited?.structural);
  const grounded =
    'Retry policy is the host\'s alone [cite:/ground/repo/src/kernel/run/coordinator.ts].';
  const inRoot = cited.structural(grounded, brief(['claims-cited']), {
    groundRoots: ['/ground/repo'],
  });
  assert.equal(inRoot.passed, true, 'ground under a licensed root is evidence');
  const outOfRoot = cited.structural(grounded, brief(['claims-cited']), {
    groundRoots: ['/somewhere/else'],
  });
  assert.equal(outOfRoot.passed, false, 'an unlicensed tree is still not evidence');
});

test('the heading the template dictates satisfies scope-diff: hyphenated headings are the spaced label', () => {
  const scope = challengeById('scope-diff');
  assert.ok(scope?.structural);
  const templateLiteral = [
    '# product requirements document',
    'The work, cited [cite:docs/plan.md].',
    '',
    '## out-of-scope',
    'Remote connectors wait for a later phase.',
  ].join('\n');
  const check = scope.structural(templateLiteral, brief(['scope-diff']));
  assert.equal(check.passed, true, 'the checker must not fail its own dictated heading');

  const premortem = challengeById('pre-mortem');
  assert.ok(premortem?.structural);
  assert.equal(
    premortem.structural('## Pre-mortem\nIt fails when...', brief(['pre-mortem'])).passed,
    true,
    'hyphen flattening keeps pre-mortem detection whole',
  );
});

/**
 * A named path is a question the role could have answered.
 *
 * The failure this closes was observed whole: a strategy run's open questions
 * named the exact files that would settle them — the auth module, the canonical
 * write path, a boundary test — inside a repository the roles had been licensed
 * to read, and the run reported all of them as unanswered. The check holds the
 * three honest endings apart from the fourth: read it, could not read it, or
 * read it and it did not settle, versus named it and stopped.
 */
test('a path named but never read fails the ground-exhausted challenge', () => {
  const roots = ['/ground/repo'];
  const named =
    '## open-questions\n' +
    '- Which auth mode is deployed is unresolved; apps/admin/src/auth/server-authorization.ts\n' +
    '  was not read to confirm which document matches the deployed default.\n';

  const check = challengeById('ground-exhausted')?.structural?.(named, brief([]), {
    groundRoots: roots,
  });

  assert.equal(check?.passed, false);
  assert.match(check?.detail ?? '', /server-authorization\.ts/);
});

test('a path the deliverable cites counts as read wherever else it is discussed', () => {
  const roots = ['/ground/repo'];
  const read =
    '## finding\n' +
    '- The deployed default is supabase [cite:apps/admin/src/auth/server-authorization.ts].\n' +
    '## open-questions\n' +
    '- Whether apps/admin/src/auth/server-authorization.ts also governs the bulk path\n' +
    '  is not settled by what it contains.\n';

  const check = challengeById('ground-exhausted')?.structural?.(read, brief([]), {
    groundRoots: roots,
  });

  assert.equal(check?.passed, true);
});

test('a path that could not be opened passes when the deliverable says so', () => {
  const roots = ['/ground/repo'];
  const blocked =
    '## open-questions\n' +
    '- packages/domain/src/statistics/theme-impact-packet.ts could not be read: the host\n' +
    '  returned a permission error, so the data contract is unverified [unverified].\n';

  const check = challengeById('ground-exhausted')?.structural?.(blocked, brief([]), {
    groundRoots: roots,
  });

  assert.equal(check?.passed, true);
});

/**
 * Without roots there was nothing further to reach, so the same text passes.
 * A role handed a fixed document list and no license is not withholding work
 * by naming a file it never had — holding it to this check would punish it for
 * the dispatch it was given.
 */
test('an ungrounded dispatch passes the ground-exhausted challenge saying why', () => {
  const named = '## open-questions\n- src/auth/server-authorization.ts was not read.\n';

  const check = challengeById('ground-exhausted')?.structural?.(named, brief([]), {});

  assert.equal(check?.passed, true);
  assert.match(check?.detail ?? '', /no declared roots/);
});

/**
 * Two different failures wear the same shape and only one justifies the strong
 * sentence. From a recorded run: a role wrote that it had opened every document
 * a question needed, cited none of them by marker, and was told in the same
 * breath that it had left fourteen pieces of work undone. The check still
 * fails — a reader cannot tell in either case — but it stops asserting the
 * thing it cannot know.
 */
test('a deliverable that cites nothing is not told it left work undone', () => {
  const draft =
    'I opened docs/a.md and docs/b.md and neither settles the question. ' +
    'See also docs/c.md for the surrounding decision.';

  const run = runStructuralChallenges(brief(['ground-exhausted']), draft, {
    groundRoots: ['/repo'],
  });

  assert.equal(run.results[0].passed, false);
  assert.match(run.results[0].detail, /no citation marker anywhere/);
  assert.doesNotMatch(run.results[0].detail, /work it could have done/);
});

test('a deliverable that cites elsewhere and not here is told exactly that', () => {
  const draft =
    'The bar is stated in the ops note [cite:docs/a.md]. See also docs/unopened.md.';

  const run = runStructuralChallenges(brief(['ground-exhausted']), draft, {
    groundRoots: ['/repo'],
  });

  assert.equal(run.results[0].passed, false);
  assert.match(run.results[0].detail, /cites elsewhere/);
  assert.match(run.results[0].detail, /work it could have done/);
});
