/**
 * tests/scripts/release-evidence-gate.test.mjs — self-test for the
 * release packaging evidence gate (scripts/release-evidence-gate.mjs).
 *
 * Pins: the gate passes on the committed clean tree (packaging-only, fast);
 * a capability marked 'implemented' with a missing backing file is a seeded
 * packaging mismatch that fails the gate by name; a capability with no
 * registered backing-file/acceptance-test mapping is itself a failure (the
 * map cannot silently fall behind CAPABILITY_REGISTRY); and a failing
 * acceptance test fails the gate while a self-skip does not.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  runReleaseEvidenceGate,
  CAPABILITY_BACKING_FILES,
  CAPABILITY_ACCEPTANCE_TESTS,
} from '../../scripts/release-evidence-gate.mjs';
import { CAPABILITY_REGISTRY } from '../../lib/mode-capabilities.mjs';

test('gate passes on the committed clean tree (packaging only)', () => {
  const result = runReleaseEvidenceGate({ runAcceptanceTests: false });
  assert.equal(result.ok, true, `expected clean tree to pass; errors:\n${result.errors.join('\n')}`);
  assert.equal(result.errors.length, 0);
  assert.ok(result.capabilities.length > 0);
});

test('every implemented capability in the real registry has both a backing-file and an acceptance-test mapping', () => {
  const missing = [];
  for (const mode of Object.keys(CAPABILITY_REGISTRY)) {
    for (const cap of CAPABILITY_REGISTRY[mode]) {
      if (cap.status !== 'implemented') continue;
      if (!CAPABILITY_BACKING_FILES[cap.id]) missing.push(`${mode}/${cap.id}: no CAPABILITY_BACKING_FILES entry`);
      if (!CAPABILITY_ACCEPTANCE_TESTS[cap.id]) missing.push(`${mode}/${cap.id}: no CAPABILITY_ACCEPTANCE_TESTS entry`);
    }
  }
  assert.deepEqual(missing, []);
});

test('a seeded packaging mismatch (implemented capability missing its backing file) fails the gate by name', () => {
  const capabilityRegistry = { solo: [{ id: 'fixture-cap', label: 'Fixture capability', status: 'implemented' }] };
  const result = runReleaseEvidenceGate({
    capabilityRegistry,
    backingFiles: { 'fixture-cap': ['lib/does-not-exist-anywhere.mjs'] },
    acceptanceTests: { 'fixture-cap': 'tests/acceptance/modes/solo.acceptance.test.mjs' },
    runAcceptanceTests: false,
    packedFiles: new Set(['bin/construct', 'lib/observation-store.mjs']),
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('solo/fixture-cap') && e.includes('lib/does-not-exist-anywhere.mjs')));
});

test('an implemented capability with no registered backing-file mapping fails the gate', () => {
  const capabilityRegistry = { solo: [{ id: 'unregistered-cap', label: 'Unregistered', status: 'implemented' }] };
  const result = runReleaseEvidenceGate({
    capabilityRegistry,
    backingFiles: {},
    acceptanceTests: { 'unregistered-cap': 'tests/acceptance/modes/solo.acceptance.test.mjs' },
    runAcceptanceTests: false,
    packedFiles: new Set(['bin/construct']),
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('unregistered-cap') && e.includes('no CAPABILITY_BACKING_FILES entry')));
});

test('an implemented capability with no registered acceptance test fails the gate', () => {
  const capabilityRegistry = { solo: [{ id: 'no-test-cap', label: 'No test', status: 'implemented' }] };
  const result = runReleaseEvidenceGate({
    capabilityRegistry,
    backingFiles: { 'no-test-cap': ['bin/construct'] },
    acceptanceTests: {},
    runAcceptanceTests: false,
    packedFiles: new Set(['bin/construct']),
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('no-test-cap') && e.includes('no CAPABILITY_ACCEPTANCE_TESTS entry')));
});

test('a stub or not-implemented capability is never checked (a status change is required before the gate looks at it)', () => {
  const capabilityRegistry = { team: [{ id: 'stub-cap', label: 'Stub', status: 'stub' }] };
  const result = runReleaseEvidenceGate({ capabilityRegistry, runAcceptanceTests: false, packedFiles: new Set() });
  assert.equal(result.ok, true);
  assert.deepEqual(result.capabilities, []);
});

test('a failing acceptance test fails the gate; a self-skipped test does not', () => {
  const capabilityRegistry = { solo: [{ id: 'fixture-cap', label: 'Fixture', status: 'implemented' }] };
  const fakeExecFileFailing = () => {
    const err = new Error('exit 1');
    err.stdout = 'ℹ tests 1\nℹ pass 0\nℹ fail 1\nℹ skipped 0\n';
    err.stderr = 'assertion failed';
    throw err;
  };
  const failing = runReleaseEvidenceGate({
    capabilityRegistry,
    backingFiles: { 'fixture-cap': ['bin/construct'] },
    acceptanceTests: { 'fixture-cap': 'tests/acceptance/modes/solo.acceptance.test.mjs' },
    packedFiles: new Set(['bin/construct']),
    execFile: fakeExecFileFailing,
  });
  assert.equal(failing.ok, false);
  assert.ok(failing.errors.some((e) => e.includes('acceptance test failed')));

  const fakeExecFileSkipped = () => 'ℹ tests 1\nℹ pass 1\nℹ fail 0\nℹ skipped 1\n';
  const skipped = runReleaseEvidenceGate({
    capabilityRegistry,
    backingFiles: { 'fixture-cap': ['bin/construct'] },
    acceptanceTests: { 'fixture-cap': 'tests/acceptance/modes/solo.acceptance.test.mjs' },
    packedFiles: new Set(['bin/construct']),
    execFile: fakeExecFileSkipped,
  });
  assert.equal(skipped.ok, true);
  assert.ok(skipped.warnings.some((w) => w.includes('self-skipped')));
});
