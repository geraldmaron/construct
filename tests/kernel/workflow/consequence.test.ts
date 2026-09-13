/**
 * tests/kernel/workflow/consequence.test.ts — professional challenge is
 * selected from request signals and project scale, not from magic words.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessConsequence } from '../../../src/kernel/workflow/consequence.ts';

test('a shared database is challenged without the person saying challenge; a helper rename is not', () => {
  const arch = assessConsequence('Introduce a shared database for billing and identity', 'solo');
  assert.equal(arch.depth, 'challenged');
  assert.equal(arch.challenge, true);
  const rename = assessConsequence('Rename a private helper in the invoice formatter', 'organization');
  assert.equal(rename.depth, 'light');
  assert.equal(rename.challenge, false);
});

test('the same mid-weight request is lighter on a side project than in a multi-team system', () => {
  const request = 'Migrate the billing schema to the new platform';
  const side = assessConsequence(request, 'side_project');
  const org = assessConsequence(request, 'organization');
  assert.equal(side.challenge, true, 'schema migration is challenged at any scale');
  assert.equal(org.challenge, true);
  const mid = 'Refactor the ownership of the billing reports';
  const small = assessConsequence(mid, 'side_project');
  const large = assessConsequence(mid, 'multi_team');
  assert.equal(small.depth, 'light');
  assert.equal(large.challenge, true);
});

test('unusual consequential phrasing is challenged without the old magic phrases', () => {
  // These avoid "shared database", "security boundary", "schema migration", etc.
  const sameStore = assessConsequence('Put identity and billing on the same postgres', 'solo');
  assert.equal(sameStore.challenge, true, 'same postgres is a shared store even without saying shared database');

  const openNet = assessConsequence('Open this endpoint to the internet with no auth', 'side_project');
  assert.equal(openNet.challenge, true, 'an open unauthenticated boundary must be challenged');

  const wipe = assessConsequence('Delete the production audit logs after launch', 'solo');
  assert.equal(wipe.challenge, true, 'destructive production data work must be challenged');

  const withSkills = assessConsequence('Retune the postgres indexes for the reporter', 'side_project', {
    likelySkills: ['system-architecture'],
  });
  assert.equal(assessConsequence('Retune the postgres indexes for the reporter', 'side_project').challenge, false);
  assert.equal(withSkills.challenge, true, 'likely architecture skill tips a strong store signal');

  const workflow = assessConsequence('Write a short status update', 'side_project', { workflowChallenge: true });
  assert.equal(workflow.challenge, true, 'workflow deliverable.challenge is decisive');

  const contradiction = assessConsequence('Tidy the docs a little', 'side_project', { activeContradictions: 1 });
  assert.equal(contradiction.challenge, true, 'an open governing contradiction forces challenge');
});

test('trivial reversible work stays light even when scale is high', () => {
  for (const text of [
    'Rename a private helper in the invoice formatter',
    'Fix a typo in the README',
    'Sort the imports in utils.ts',
    'Add a comment explaining the timeout',
  ]) {
    const j = assessConsequence(text, 'organization');
    assert.equal(j.challenge, false, text);
    assert.equal(j.depth, 'light', text);
  }
});

test('external or destructive step tiers raise challenge without magic wording', () => {
  const external = assessConsequence('Update the tracker ticket description', 'side_project', {
    stepTiers: ['external_write'],
  });
  assert.equal(external.challenge, true);
  const destructive = assessConsequence('Clean up old rows', 'side_project', { stepTiers: ['destructive'] });
  assert.equal(destructive.challenge, true);
});
