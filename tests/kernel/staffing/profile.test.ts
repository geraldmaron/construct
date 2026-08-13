/**
 * tests/kernel/staffing/profile.test.ts — staffing an unmet concern is gated,
 * and every refusal is a stated no rather than a silence.
 *
 * The property that matters most here is the one that is easiest to lose: this
 * gate must be able to say no. A staffing path that admits whatever it is
 * handed is the "we can do everything" claim in code, and it produces exactly
 * the predecessor's roster of roles whose grades nobody computed. So each
 * refusal has its own test, the accept path is asserted to be the narrow case
 * rather than the default, and the inbox entry is asserted to default to NOT
 * staffed.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { sterile } from '../../harness/sterile.ts';
import { openStore } from '../../../src/kernel/store/open.ts';
import { openDecisions } from '../../../src/kernel/store/decisions.ts';
import {
  NOT_STAFFED,
  claimedBy,
  evaluateProfile,
  professionsCarried,
  proposeStaffing,
} from '../../../src/kernel/staffing/profile.ts';
import type { StaffingProposal } from '../../../src/kernel/staffing/profile.ts';

const AT = '2026-08-13T00:00:00.000Z';

/**
 * A concern the live catalog genuinely does not carry, drawn from the gap a
 * real aggregator project left open: the people in a historical record have
 * descendants, and nothing in the catalog notices them.
 */
const CONSENT: StaffingProposal = {
  proposed: 'community-consent',
  concern: 'who is depicted in material about a community and what they were promised about its use',
  rebuttals: [],
  standards: [
    {
      name: 'Protocols for Native American Archival Materials',
      publisher: 'First Archivists Circle',
      contributes: 'the question of who holds authority over material about a community',
    },
  ],
  slots: [{ name: 'depicted-parties', expects: 'who is depicted and what was promised', required: true }],
};

function withStore<T>(body: (store: ReturnType<typeof openStore>) => T): T {
  const fixture = sterile();
  const store = openStore(join(fixture.paths.dataDir, 'construct.db'));
  try {
    return body(store);
  } finally {
    store.close();
    fixture.cleanup();
  }
}

test('a concern with a practice, slots, and its neighbours answered is admitted as grounded', () => {
  const claimants = claimedBy(CONSENT.concern);
  const outcome = evaluateProfile({
    ...CONSENT,
    rebuttals: claimants.map((domain) => ({
      domain,
      whyNot: `${domain} asks a different question of the same words`,
    })),
  });
  assert.ok(outcome.admitted, `expected admission, got: ${outcome.refused?.reason}`);
  assert.equal(outcome.admitted.evidenceTier, 'grounded');
  assert.match(
    outcome.admitted.tierReason,
    /no run has exercised this profile/,
    'the tier must state what it does not know, or it is a grade somebody gave',
  );
});

test('a domain the catalog already carries is refused with that domain named', () => {
  const outcome = evaluateProfile({ ...CONSENT, proposed: 'privacy' });
  assert.equal(outcome.refused?.kind, 'already-covered');
  assert.equal(outcome.refused?.domain, 'privacy');
});

test('a neighbour that claims the concern words and is not answered refuses the profile', () => {
  // The concern below trips an existing domain's dictionary on purpose. The
  // gate must make the proposer say what that domain would miss rather than
  // letting a second role quietly overlap the first.
  const outcome = evaluateProfile({
    ...CONSENT,
    proposed: 'descendant-notice',
    concern: 'consent and personal data of the people named in archival records',
    rebuttals: [],
  });
  assert.equal(outcome.refused?.kind, 'already-covered');
  assert.equal(outcome.refused?.domain, 'privacy');
  assert.match(outcome.refused.reason, /say what it would miss, or route the concern to it/);
});

test('answering the neighbour clears that refusal without weakening the others', () => {
  const outcome = evaluateProfile({
    ...CONSENT,
    proposed: 'descendant-notice',
    concern: 'consent and personal data of the people named in archival records',
    rebuttals: [
      {
        domain: 'privacy',
        whyNot: 'privacy asks whether the living can be identified; this asks what the dead were promised',
      },
      ...claimedBy('consent and personal data of the people named in archival records')
        .filter((d) => d !== 'privacy')
        .map((domain) => ({ domain, whyNot: 'answers a different question of the same words' })),
    ],
  });
  assert.ok(outcome.admitted, `expected admission, got: ${outcome.refused?.reason}`);
});

test('a concern needing a profession the catalog never answered to is refused outright', () => {
  const outcome = evaluateProfile({
    ...CONSENT,
    proposed: 'clinical-safety',
    concern: 'whether guidance given to a reader could harm them',
    licensedReview: 'physician',
    rebuttals: [],
  });
  assert.equal(outcome.refused?.kind, 'licensed-profession');
  assert.match(outcome.refused.reason, /construct cannot staff it/);
  assert.ok(
    !professionsCarried().has('physician'),
    'this test is only meaningful while no domain answers to a physician',
  );
});

test('a concern whose review profession the catalog already carries is not refused for that reason', () => {
  const concern = 'exposure created by naming a person in published material';
  const outcome = evaluateProfile({
    ...CONSENT,
    proposed: 'naming-exposure',
    concern,
    licensedReview: 'attorney',
    rebuttals: claimedBy(concern).map((domain) => ({ domain, whyNot: 'asks a different question' })),
  });
  assert.ok(
    outcome.admitted || outcome.refused?.kind !== 'licensed-profession',
    'attorney review is already carried, so it cannot be the ground for refusing',
  );
});

test('a profile citing no practice and giving no reason is refused as invented', () => {
  const claimants = claimedBy(CONSENT.concern);
  const outcome = evaluateProfile({
    ...CONSENT,
    standards: [],
    rebuttals: claimants.map((domain) => ({ domain, whyNot: 'asks a different question' })),
  });
  assert.equal(outcome.refused?.kind, 'no-practice-to-name');
});

test('a stated absence of practice is admissible and carries the label', () => {
  const claimants = claimedBy(CONSENT.concern);
  const outcome = evaluateProfile({
    ...CONSENT,
    standards: [],
    ungrounded: 'the practice here is local and unwritten; no published standard governs it',
    rebuttals: claimants.map((domain) => ({ domain, whyNot: 'asks a different question' })),
  });
  assert.equal(outcome.admitted?.evidenceTier, 'unproven');
});

test('a profile with no slots is refused, because nothing it produced could be checked', () => {
  const outcome = evaluateProfile({ ...CONSENT, slots: [] });
  assert.equal(outcome.refused?.kind, 'malformed');
});

test('the inbox entry defaults to not staffed, and says so as its own position', () => {
  withStore((store) => {
    const claimants = claimedBy(CONSENT.concern);
    const outcome = evaluateProfile({
      ...CONSENT,
      rebuttals: claimants.map((domain) => ({ domain, whyNot: 'asks a different question' })),
    });
    assert.ok(outcome.admitted);
    proposeStaffing(store, {
      id: 'staffing-1',
      run: 'run-1',
      profile: outcome.admitted,
      raisedBy: 'the namer proposed it while reading the outcome',
      at: AT,
    });

    const open = openDecisions(store, 'run-1');
    assert.equal(open.length, 1);
    assert.match(open[0].question, /Should the catalog carry "community-consent"/);
    const stances = open[0].positions.map((p) => p.stance);
    assert.ok(
      stances.some((s) => s === NOT_STAFFED),
      'the default must appear as a position, not as an absence of one',
    );
    assert.ok(stances.some((s) => s.includes('staff it as "community-consent"')));
  });
});

test('proposing does not change the catalog; only an accepted profile ever could', () => {
  withStore((store) => {
    const before = claimedBy(CONSENT.concern).join(',');
    const claimants = claimedBy(CONSENT.concern);
    const outcome = evaluateProfile({
      ...CONSENT,
      rebuttals: claimants.map((domain) => ({ domain, whyNot: 'asks a different question' })),
    });
    proposeStaffing(store, {
      id: 'staffing-2',
      run: 'run-2',
      profile: outcome.admitted!,
      at: AT,
    });
    assert.equal(claimedBy(CONSENT.concern).join(','), before, 'a proposal must not route anything');
  });
});
