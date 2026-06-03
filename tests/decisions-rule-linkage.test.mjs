/**
 * tests/decisions-rule-linkage.test.mjs — rule → enforcer linkage validation.
 *
 * @enforces ADR-0015
 *
 * A rule may name its enforcer in frontmatter (enforced_by, adr_reference). Bead
 * construct-wvbf.4 pins that a declared enforcer path must exist and a declared
 * adr_reference must resolve — so a rule cannot claim an enforcement that is not
 * there. Absent linkage is allowed; broken linkage fails.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { checkRuleLinkage, buildRegistry } from '../lib/decisions/registry.mjs';

test('the live tree has no broken rule linkage', () => {
  const { ok, violations } = checkRuleLinkage();
  assert.equal(ok, true, violations.join('; '));
});

test('seeded rules declare a resolvable enforcer and ADR', () => {
  const { byId } = buildRegistry();
  const rule = byId.get('rule:common/no-fabrication');
  assert.ok(rule, 'no-fabrication rule indexed');
  assert.ok(rule.enforcedBy.includes('lib/comment-lint.mjs'), 'declares comment-lint as enforcer');
  assert.equal(rule.adrReference, 'ADR-0015');
  assert.equal(rule.advisory, false, 'a rule with an enforcer is not advisory');
});
