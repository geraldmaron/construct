/**
 * tests/doctor-stub-tier.test.mjs — Unit tests for the stub/not-implemented tier
 * added to lib/doctor/diagnosis.mjs.
 *
 * Covers:
 *   1. DOCTOR_STATES includes the 'stub' level.
 *   2. classifyCapabilitySync returns 'implemented', 'stub', or 'not-implemented'
 *      based on the capability status in a supplied caps array.
 *   3. diagnosisLevelForCapability maps classifications to diagnosis levels.
 *   4. diagnosisMessageForCapability returns distinct messages per classification.
 *   5. renderDiagnosisLevel renders 'stub' with a distinct icon ('~').
 *   6. classifyCapability (async) round-trips through the real mode-capabilities
 *      registry for the 'solo' mode.
 *
 * Bead: construct-9oi4.13.4 — LMCP-M4
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DOCTOR_STATES,
  STUB_ICON,
  classifyCapabilitySync,
  classifyCapability,
  diagnosisLevelForCapability,
  diagnosisMessageForCapability,
  renderDiagnosisLevel,
} from '../lib/doctor/diagnosis.mjs';

// ---------------------------------------------------------------------------
// Taxonomy: DOCTOR_STATES includes 'stub'
// ---------------------------------------------------------------------------

test('DOCTOR_STATES: includes the stub level', () => {
  assert.ok('stub' in DOCTOR_STATES, "DOCTOR_STATES should have a 'stub' key");
  assert.equal(typeof DOCTOR_STATES.stub, 'string');
  assert.ok(DOCTOR_STATES.stub.length > 0, 'stub description should be non-empty');
});

test('DOCTOR_STATES: existing levels are still present', () => {
  const required = ['healthy', 'degraded', 'missing-config', 'disabled', 'secret-leak', 'entrypoint-missing'];
  for (const level of required) {
    assert.ok(level in DOCTOR_STATES, `DOCTOR_STATES should still have '${level}'`);
  }
});

// ---------------------------------------------------------------------------
// classifyCapabilitySync
// ---------------------------------------------------------------------------

test('classifyCapabilitySync: implemented capability → implemented', () => {
  const caps = [{ id: 'filesystem-queue', label: 'Filesystem task queue', status: 'implemented' }];
  assert.equal(classifyCapabilitySync('filesystem-queue', caps), 'implemented');
});

test('classifyCapabilitySync: stub capability → stub', () => {
  const caps = [{ id: 'postgres-queue', label: 'Postgres task queue', status: 'stub' }];
  assert.equal(classifyCapabilitySync('postgres-queue', caps), 'stub');
});

test('classifyCapabilitySync: not-implemented capability → not-implemented', () => {
  const caps = [{ id: 'rbac', label: 'RBAC/ABAC', status: 'not-implemented' }];
  assert.equal(classifyCapabilitySync('rbac', caps), 'not-implemented');
});

test('classifyCapabilitySync: unknown capability id → not-implemented', () => {
  const caps = [{ id: 'filesystem-queue', label: 'Filesystem task queue', status: 'implemented' }];
  assert.equal(classifyCapabilitySync('does-not-exist', caps), 'not-implemented');
});

test('classifyCapabilitySync: empty caps array → not-implemented', () => {
  assert.equal(classifyCapabilitySync('anything', []), 'not-implemented');
});

test('classifyCapabilitySync: null caps → not-implemented', () => {
  assert.equal(classifyCapabilitySync('anything', null), 'not-implemented');
});

// ---------------------------------------------------------------------------
// diagnosisLevelForCapability
// ---------------------------------------------------------------------------

test('diagnosisLevelForCapability: implemented → healthy', () => {
  assert.equal(diagnosisLevelForCapability('implemented'), 'healthy');
});

test('diagnosisLevelForCapability: stub → stub', () => {
  assert.equal(diagnosisLevelForCapability('stub'), 'stub');
});

test('diagnosisLevelForCapability: not-implemented → stub', () => {
  assert.equal(diagnosisLevelForCapability('not-implemented'), 'stub');
});

// ---------------------------------------------------------------------------
// diagnosisMessageForCapability
// ---------------------------------------------------------------------------

test('diagnosisMessageForCapability: implemented → "Fully implemented"', () => {
  assert.equal(diagnosisMessageForCapability('implemented'), 'Fully implemented');
});

test('diagnosisMessageForCapability: stub → "Partial implementation"', () => {
  assert.equal(diagnosisMessageForCapability('stub'), 'Partial implementation');
});

test('diagnosisMessageForCapability: not-implemented → "Not implemented"', () => {
  assert.equal(diagnosisMessageForCapability('not-implemented'), 'Not implemented');
});

// ---------------------------------------------------------------------------
// renderDiagnosisLevel — stub rendered distinctly from healthy/degraded/error
// ---------------------------------------------------------------------------

test('renderDiagnosisLevel: healthy → ✓', () => {
  assert.equal(renderDiagnosisLevel('healthy'), '✓');
});

test('renderDiagnosisLevel: degraded → ⚠', () => {
  assert.equal(renderDiagnosisLevel('degraded'), '⚠');
});

test('renderDiagnosisLevel: stub → STUB_ICON (~)', () => {
  const icon = renderDiagnosisLevel('stub');
  assert.equal(icon, STUB_ICON, 'stub level should render with STUB_ICON');
  assert.equal(icon, '~', 'stub icon should be ~');
  assert.notEqual(icon, '✓', 'stub should not render as healthy');
  assert.notEqual(icon, '✗', 'stub should not render as error');
});

test('renderDiagnosisLevel: unknown level → ✗', () => {
  assert.equal(renderDiagnosisLevel('error'), '✗');
  assert.equal(renderDiagnosisLevel('missing-config'), '✗');
  assert.equal(renderDiagnosisLevel(''), '✗');
});

// ---------------------------------------------------------------------------
// classifyCapability (async) — integration with real mode-capabilities
// ---------------------------------------------------------------------------

test('classifyCapability (async): solo mode filesystem-queue → implemented', async () => {
  const result = await classifyCapability('filesystem-queue', 'solo');
  assert.equal(result, 'implemented');
});

test('classifyCapability (async): team mode postgres-queue → stub', async () => {
  const result = await classifyCapability('postgres-queue', 'team');
  assert.equal(result, 'stub');
});

test('classifyCapability (async): team mode docker-workers → not-implemented', async () => {
  const result = await classifyCapability('docker-workers', 'team');
  assert.equal(result, 'not-implemented');
});

test('classifyCapability (async): enterprise mode rbac → not-implemented', async () => {
  const result = await classifyCapability('rbac', 'enterprise');
  assert.equal(result, 'not-implemented');
});

test('classifyCapability (async): unknown mode → not-implemented', async () => {
  const result = await classifyCapability('anything', 'unknown-mode');
  assert.equal(result, 'not-implemented');
});

// ---------------------------------------------------------------------------
// End-to-end: stub level renders distinctly in a formatted output string
// ---------------------------------------------------------------------------

test('stub level pipeline: not-implemented capability → stub level → distinct icon in formatted output', () => {
  // Simulate the full pipeline a renderer would execute:
  //   caps array → classify → level → icon + message
  const caps = [{ id: 'rbac', label: 'RBAC/ABAC', status: 'not-implemented' }];
  const classification = classifyCapabilitySync('rbac', caps);
  const level = diagnosisLevelForCapability(classification);
  const message = diagnosisMessageForCapability(classification);
  const icon = renderDiagnosisLevel(level);

  assert.equal(classification, 'not-implemented');
  assert.equal(level, 'stub');
  assert.equal(message, 'Not implemented');
  assert.equal(icon, '~');

  // Simulate a rendered line
  const line = `  ${icon} rbac (${level}) — ${message}`;
  assert.ok(line.includes('~'), 'rendered line should contain the stub icon');
  assert.ok(line.includes('Not implemented'), 'rendered line should contain the message');
  assert.ok(!line.includes('✓'), 'rendered line should not show healthy icon');
});

test('stub level pipeline: stub capability → stub level → distinct icon in formatted output', () => {
  const caps = [{ id: 'postgres-queue', label: 'Postgres task queue', status: 'stub' }];
  const classification = classifyCapabilitySync('postgres-queue', caps);
  const level = diagnosisLevelForCapability(classification);
  const message = diagnosisMessageForCapability(classification);
  const icon = renderDiagnosisLevel(level);

  assert.equal(classification, 'stub');
  assert.equal(level, 'stub');
  assert.equal(message, 'Partial implementation');
  assert.equal(icon, '~');
});

test('stub level pipeline: implemented capability → pass (healthy) level → ✓ icon', () => {
  const caps = [{ id: 'filesystem-queue', label: 'Filesystem task queue', status: 'implemented' }];
  const classification = classifyCapabilitySync('filesystem-queue', caps);
  const level = diagnosisLevelForCapability(classification);
  const message = diagnosisMessageForCapability(classification);
  const icon = renderDiagnosisLevel(level);

  assert.equal(classification, 'implemented');
  assert.equal(level, 'healthy');
  assert.equal(message, 'Fully implemented');
  assert.equal(icon, '✓');
  assert.notEqual(icon, '~');
});
