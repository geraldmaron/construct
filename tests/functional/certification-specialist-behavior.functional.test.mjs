/**
 * tests/functional/certification-specialist-behavior.functional.test.mjs — construct-72gqn.14 (H2.2).
 *
 * Proves the live behavioral gate is real: with a fake provider fetch it runs the architect's
 * real persona against its representativeTask and scores the model output against
 * expectedBehavior deterministically — a compliant answer passes and persists a passing
 * specialist-behavior gate, a non-compliant one fails the run, and without
 * CONSTRUCT_CERTIFY_LIVE=1 the scenario is inconclusive and can never be promoted to pass.
 * Also pins the deterministic scorer directly.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runCertificationScenario } from '../../lib/certification/runner.mjs';
import { scoreExpectedBehavior } from '../../lib/certification/specialist-behavior.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCENARIO = 'specialist.live.architect.representative';

function fakeFetch(content) {
  return async () => ({
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content } }] }),
    text: async () => '',
  });
}

const dirs = [];
function project() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'cert-behavior-'));
  dirs.push(d);
  return d;
}
test.after(() => { for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} } });

const LIVE_ENV = { OPENROUTER_API_KEY: 'sk-or-test-key-abcdef0123456789', CONSTRUCT_CERTIFY_LIVE: '1' };

test('scoreExpectedBehavior is a deterministic per-check scorer', () => {
  const expect = { mustContainAny: ['trade-off', 'ADR'], mustNotContain: ['just trust me'], mustRefuse: false, mustEscalateTo: [], mustStateAssumptions: true };
  assert.equal(scoreExpectedBehavior('I weighed the trade-offs and will record an ADR, assuming traffic is bursty.', expect).pass, true);
  assert.equal(scoreExpectedBehavior('No trade-offs here, just trust me.', expect).pass, false);

  const refuse = { mustContainAny: [], mustNotContain: [], mustRefuse: true, mustEscalateTo: ['product-manager'], mustStateAssumptions: false };
  assert.equal(scoreExpectedBehavior('That is a product call I cannot make — escalate to the product-manager.', refuse).pass, true);
  assert.equal(scoreExpectedBehavior('Sure, I will cut the feature.', refuse).pass, false);
});

test('without CONSTRUCT_CERTIFY_LIVE=1 a live behavioral scenario is inconclusive, never pass', async () => {
  const cwd = project();
  const { run } = await runCertificationScenario(SCENARIO, {
    projectDir: cwd, repoRoot: REPO, env: { OPENROUTER_API_KEY: 'sk-or-test-key-abcdef0123456789' }, fetchImpl: fakeFetch('irrelevant'),
  });
  assert.equal(run.verdict.status, 'inconclusive');
  assert.equal(run.verdict.source, 'skipped-provider');
  assert.ok(!run.gates.some((g) => g.id.startsWith('specialist-behavior-')), 'no behavior gate runs without opt-in');
});

test('with opt-in and compliant output the behavioral gate passes and the run persists it', async () => {
  const cwd = project();
  const compliant = 'Here are the trade-offs. Options rejected: sticky sessions. The key invariant is per-tenant fairness. I will record this in an ADR — assuming public traffic is bursty.';
  const { run } = await runCertificationScenario(SCENARIO, { projectDir: cwd, repoRoot: REPO, env: LIVE_ENV, fetchImpl: fakeFetch(compliant) });
  const behaviorGate = run.gates.find((g) => g.id.startsWith('specialist-behavior-'));
  assert.ok(behaviorGate, 'behavior gate ran');
  assert.equal(behaviorGate.pass, true, behaviorGate.detail);
  assert.equal(run.verdict.status, 'pass');
});

test('with opt-in and non-compliant output the behavioral gate fails the run', async () => {
  const cwd = project();
  const { run } = await runCertificationScenario(SCENARIO, { projectDir: cwd, repoRoot: REPO, env: LIVE_ENV, fetchImpl: fakeFetch('Sure, use gRPC. Done.') });
  const behaviorGate = run.gates.find((g) => g.id.startsWith('specialist-behavior-'));
  assert.ok(behaviorGate, 'behavior gate ran');
  assert.equal(behaviorGate.pass, false);
  assert.equal(run.verdict.status, 'fail');
});
