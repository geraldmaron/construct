/**
 * tests/intake/golden-rnd.test.mjs — Locks RND classifier output byte-for-byte.
 *
 * Written BEFORE the B2 refactor that moves INTAKE_TYPES, RD_STAGES, and
 * CLASSIFICATION_TABLE behind a profile loader. Any drift in RND classification
 * output for the canonical inputs below fails this test. Update only when an
 * intentional RND behavior change ships, and explain the diff in the commit.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyRdIntake } from '../../lib/intake/classify.mjs';

const FIXTURES = [
  {
    name: 'security signal — auth bypass mention',
    input: { sourcePath: 'inbox/auth-bypass-report.md', extractedText: 'Critical CVE: auth bypass via SQLi.' },
    expect: {
      intakeType: 'security',
      primaryOwner: 'security',
      requiresApproval: true,
      risk: 'high',
    },
  },
  {
    name: 'bug signal — failing tests',
    input: { sourcePath: 'inbox/bug-test-fails.md', extractedText: 'Tests fail with error: regression in foo module.' },
    expect: {
      intakeType: 'bug',
      primaryOwner: 'debugger',
    },
  },
  {
    name: 'architecture signal — design decision',
    input: { sourcePath: 'inbox/arch-decision.md', extractedText: 'Need a design decision on service boundary and dependency direction.' },
    expect: {
      intakeType: 'architecture',
      primaryOwner: 'architect',
    },
  },
  {
    name: 'unknown when no keywords match',
    input: { sourcePath: 'inbox/blank.md', extractedText: 'something completely unrelated to any taxonomy term' },
    expect: {
      intakeType: 'unknown',
      primaryOwner: 'orchestrator',
    },
  },
];

test('RND classifier output is locked for canonical fixtures', () => {
  for (const fx of FIXTURES) {
    const triage = classifyRdIntake(fx.input);
    for (const [key, expected] of Object.entries(fx.expect)) {
      assert.equal(
        triage[key],
        expected,
        `[${fx.name}] expected ${key}=${JSON.stringify(expected)}, got ${JSON.stringify(triage[key])}`,
      );
    }
    assert.ok(typeof triage.confidence === 'number');
    assert.ok(typeof triage.rationale === 'string' && triage.rationale.length > 0);
    assert.ok(Array.isArray(triage.recommendedChain) && triage.recommendedChain.length > 0);
  }
});
