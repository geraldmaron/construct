/**
 * tests/kernel/capabilities/postconditions.test.ts — behavior lock for the
 * postcondition harvest. fixtures/postconditions-golden.json is v2's own
 * output, captured by scripts/capture-legacy-kernel-golden.mjs.
 *
 * The corpus deliberately includes the near-misses that make these rules worth
 * having: a whitespace-only "no issues found" statement, a threat model dated
 * before the brief started, a truthy-but-not-`true` flag. Those are the shapes
 * a producer emits when it is going through the motions.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  POSTCONDITIONS,
  describePostconditions,
  validateBinaryPostconditions,
} from '../../../src/kernel/capabilities/postconditions.ts';

interface Golden {
  readonly producers: Record<string, { id: string; description: string }[]>;
  readonly cases: {
    readonly name: string;
    readonly producer: string;
    readonly packet: unknown;
    readonly result: { ok: boolean; producer: string; failures: { id: string; reason: string }[] };
  }[];
}

const GOLDEN: Golden = JSON.parse(
  readFileSync(new URL('../fixtures/postconditions-golden.json', import.meta.url), 'utf8'),
);

test('corpus exercises both outcomes for every registered producer', () => {
  for (const producer of Object.keys(POSTCONDITIONS)) {
    const cases = GOLDEN.cases.filter((c) => c.producer === producer);
    assert.ok(
      cases.some((c) => c.result.ok) && cases.some((c) => !c.result.ok),
      `producer "${producer}" needs both a passing and a failing case`,
    );
  }
});

// The verdict — which producer, ok or not, and exactly which rules failed — is
// compared to v2 verbatim. The failure `reason` is human-facing prose that was
// reworded to v3 vocabulary (see the module note), so it is asserted to be
// present and non-empty rather than byte-equal to v2's wording.
for (const c of GOLDEN.cases) {
  test(`validate matches v2 — ${c.name}`, () => {
    const actual = validateBinaryPostconditions(c.producer, c.packet);
    assert.equal(actual.ok, c.result.ok);
    assert.equal(actual.producer, c.result.producer);
    assert.deepEqual(
      actual.failures.map((f) => f.id),
      c.result.failures.map((f) => f.id),
    );
    for (const f of actual.failures) {
      assert.ok(f.reason.trim().length > 0, `${f.id} must explain itself`);
    }
  });
}

// Ids are the contract; descriptions are prose. Two descriptions were reworded
// to v3 vocabulary — v2's "docs-keeper" role is now "operations", and a
// capability contract is now a brief — so the description text is asserted to
// exist, not to match v2 byte-for-byte. The ids are asserted exactly, because
// those are what already-logged violations are keyed by.
for (const [producer, described] of Object.entries(GOLDEN.producers)) {
  test(`rule set for "${producer}" is unchanged`, () => {
    const actual = describePostconditions(producer);
    assert.deepEqual(
      actual.map((r) => r.id),
      described.map((r) => r.id),
    );
    for (const rule of actual) {
      assert.ok(rule.description.trim().length > 0, `${rule.id} needs a description`);
    }
  });
}

test('rule ids are stable — violations stay greppable across the rewrite', () => {
  const ids = Object.values(POSTCONDITIONS).flatMap((rules) => rules.map((r) => r.id));
  assert.deepEqual(
    [...ids].sort(),
    [
      'debugger.root-cause-confirmed-via',
      'designer.accessibility-check-ran',
      'docs-keeper.cross-doc-coherence-check-ran',
      'reviewer.findings-or-explicit-clear',
      'security.threat-model-not-post-hoc',
    ],
    'renaming a rule id orphans every violation already logged under the old one',
  );
  assert.equal(new Set(ids).size, ids.length, 'rule ids must be unique');
});

test('a rule that throws counts as unsatisfied, not as an escape hatch', () => {
  const hostile = new Proxy(
    {},
    {
      get() {
        throw new Error('packet exploded');
      },
    },
  );
  const result = validateBinaryPostconditions('designer', hostile);
  assert.equal(result.ok, false);
  assert.deepEqual(
    result.failures.map((f) => f.id),
    ['designer.accessibility-check-ran'],
  );
});

test('validation reports; it does not throw', () => {
  for (const producer of [...Object.keys(POSTCONDITIONS), 'nobody']) {
    assert.doesNotThrow(() => validateBinaryPostconditions(producer, undefined));
  }
});

test('describePostconditions returns nothing for an unregistered producer', () => {
  assert.deepEqual(describePostconditions('nobody'), []);
});
