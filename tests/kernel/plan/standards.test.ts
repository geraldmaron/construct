/**
 * tests/kernel/plan/standards.test.ts — every lens states what its method
 * stands on, and a dispatched role actually reads it.
 *
 * The parity tests keep the record honest in both directions: a lens without
 * a standards entry is an unchecked best-practice claim, and a standards
 * entry naming no lens is authority attached to nothing. The wiring test is
 * the one with teeth — a standards record the dispatch prompt never speaks
 * is a claim in a data file, not a method the role can apply.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LENSES } from '../../../src/kernel/plan/lenses.ts';
import { LENS_STANDARDS, standardsFor } from '../../../src/kernel/plan/standards.ts';
import { assignmentFor } from '../../../src/kernel/run/coordinator.ts';
import type { Brief } from '../../../src/kernel/brief/schema.ts';

test('every lens has a standards entry, and every entry names a lens', () => {
  for (const lens of LENSES) {
    assert.ok(standardsFor(lens.lens), `lens ${lens.lens} has no standards entry`);
  }
  const lensNames = new Set(LENSES.map((l) => l.lens));
  for (const s of LENS_STANDARDS) {
    assert.ok(lensNames.has(s.lens), `standards entry ${s.lens} names no lens`);
  }
});

test('an empty reference list carries its reason; a populated one does not', () => {
  for (const s of LENS_STANDARDS) {
    if (s.refs.length === 0) {
      assert.ok(
        s.ungrounded && s.ungrounded.length > 0,
        `${s.lens} has no references and no stated reason`,
      );
    } else {
      assert.equal(
        s.ungrounded,
        undefined,
        `${s.lens} has references and also an absence reason; the two contradict`,
      );
      for (const r of s.refs) {
        assert.ok(r.name.length > 0 && r.publisher.length > 0 && r.contributes.length > 0);
      }
    }
  }
});

const brief = (role: string): Brief => ({
  id: `t-${role}`,
  outcome: 'launch a paid beta to EU users next month',
  role,
  inputs: [],
  capabilities: [],
  postconditions: [],
});

test('a dispatched role reads its lens standards; an ungrounded lens adds no invented ones', () => {
  const security = assignmentFor(brief('security'));
  assert.match(security, /Your method descends from these standards/);
  assert.match(security, /Application Security Verification Standard/);
  assert.match(security, /NIST SP 800-218/);

  const brand = assignmentFor(brief('marketing-claims'));
  assert.match(brand, /Advertising Substantiation/);

  // product's standards entry is deliberately empty, so the dispatch says
  // nothing about standards rather than inventing authority.
  const product = assignmentFor(brief('product-scoping'));
  assert.ok(!product.includes('Your method descends from these standards'));
});
