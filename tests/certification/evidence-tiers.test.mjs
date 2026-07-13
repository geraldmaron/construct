/**
 * tests/certification/evidence-tiers.test.mjs — specialist evidence-tier ladder.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { computeEvidenceTier, EVIDENCE_TIERS } from '../../lib/certification/evidence-tiers.mjs';
import { loadRegistry } from '../../lib/registry/loader.mjs';
import { certificationRunDir } from '../../lib/certification/store.mjs';
import { writeCertificationRun } from '../../lib/certification/store.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ARCHITECT = loadRegistry({ rootDir: REPO }).specialists['cx-architect'];

function baseRun(overrides = {}) {
  return {
    schemaVersion: 1,
    id: `cert-evidence-tiers-test-${randomUUID()}`,
    scenarioId: 'specialist.normal.architect',
    capabilityId: 'specialist.prompt',
    evidenceVersion: '1',
    model: { provider: 'hermetic', requestedId: 'fixture/specialist', resolvedId: 'fixture/specialist', tier: 'hermetic', paidOptIn: false, operatorAckAt: null },
    fixture: { path: 'tests/certification/scenarios/specialists/cx-architect/normal.json', sha256: 'a'.repeat(64) },
    verdict: { status: 'pass', source: 'deterministic', reason: null },
    gates: [{ id: 'specialist-normal-architect', type: 'specialist-scenario-audit', pass: true }],
    timing: { latencyMs: 12 },
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function writeAndCleanup(t, run) {
  writeCertificationRun(run, { rootDir: REPO });
  t.after(() => fs.rmSync(certificationRunDir(run.id, REPO), { recursive: true, force: true }));
}

test('EVIDENCE_TIERS is the fixed five-rung ladder', () => {
  assert.deepEqual(EVIDENCE_TIERS, ['declared', 'structurally-valid', 'behaviorally-tested', 'live-tested', 'host-proven']);
});

test('a real specialist with zero certification runs caps at structurally-valid', () => {
  const result = computeEvidenceTier(ARCHITECT, 'roles/architect', { rootDir: REPO });
  assert.equal(result.tier, 'structurally-valid');
  assert.equal(result.evidence, null);
});

test('a specialist whose prompt file is missing caps at declared, never higher', () => {
  const broken = { ...ARCHITECT, promptFile: 'specialists/prompts/cx-does-not-exist.md' };
  const result = computeEvidenceTier(broken, 'roles/architect', { rootDir: REPO });
  assert.equal(result.tier, 'declared');
});

test('a hermetic run whose only gate is specialist-scenario-audit does not lift the tier', () => {
  writeAndCleanup(test, baseRun());
  const result = computeEvidenceTier(ARCHITECT, 'roles/architect', { rootDir: REPO });
  assert.equal(result.tier, 'structurally-valid', 'fixture-shape validation alone must not read as behaviorally-tested');
});

test('a passing hermetic run with a specialist-behavior-live gate reaches behaviorally-tested', async (t) => {
  writeAndCleanup(t, baseRun({
    id: `cert-evidence-tiers-test-${randomUUID()}`,
    gates: [{ id: 'specialist-behavior-live-architect', type: 'specialist-behavior-live', pass: true }],
  }));
  const result = computeEvidenceTier(ARCHITECT, 'roles/architect', { rootDir: REPO });
  assert.equal(result.tier, 'behaviorally-tested');
  assert.ok(result.evidence?.runId);
});

test('the same gate at a non-hermetic model tier with a real verdict source reaches live-tested', async (t) => {
  writeAndCleanup(t, baseRun({
    id: `cert-evidence-tiers-test-${randomUUID()}`,
    model: { provider: 'openrouter', requestedId: 'openrouter/free-auto', resolvedId: 'meta-llama/llama-3.1-8b', tier: 'free', paidOptIn: false, operatorAckAt: null },
    gates: [{ id: 'specialist-behavior-live-architect', type: 'specialist-behavior-live', pass: true }],
  }));
  const result = computeEvidenceTier(ARCHITECT, 'roles/architect', { rootDir: REPO });
  assert.equal(result.tier, 'live-tested');
});

test('a failed behavioral gate does not lift the tier even at a live model tier', async (t) => {
  writeAndCleanup(t, baseRun({
    id: `cert-evidence-tiers-test-${randomUUID()}`,
    model: { provider: 'openrouter', requestedId: 'openrouter/free-auto', resolvedId: 'meta-llama/llama-3.1-8b', tier: 'free', paidOptIn: false, operatorAckAt: null },
    verdict: { status: 'fail', source: 'deterministic', reason: 'boundary check failed' },
    gates: [{ id: 'specialist-behavior-live-architect', type: 'specialist-behavior-live', pass: false }],
  }));
  const result = computeEvidenceTier(ARCHITECT, 'roles/architect', { rootDir: REPO });
  assert.equal(result.tier, 'structurally-valid');
});

test('the highest-tier run among several wins, not the newest', async (t) => {
  writeAndCleanup(t, baseRun());
  writeAndCleanup(t, baseRun({
    id: `cert-evidence-tiers-test-${randomUUID()}`,
    createdAt: new Date(Date.now() - 60_000).toISOString(),
    gates: [{ id: 'specialist-behavior-live-architect', type: 'specialist-behavior-live', pass: true }],
  }));
  const result = computeEvidenceTier(ARCHITECT, 'roles/architect', { rootDir: REPO });
  assert.equal(result.tier, 'behaviorally-tested', 'an older passing behavioral run must still outrank a newer structural-only run');
});
