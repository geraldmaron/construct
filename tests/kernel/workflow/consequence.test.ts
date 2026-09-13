/**
 * tests/kernel/workflow/consequence.test.ts — professional challenge is
 * selected from the request and the project's scale, not from magic words.
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
