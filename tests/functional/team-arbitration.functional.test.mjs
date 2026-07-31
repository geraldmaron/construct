/**
 * tests/functional/team-arbitration.functional.test.mjs — (L4, hermetic).
 *
 * The capstone of the specialist thread: proves the base chain actually collaborates, not
 * just runs in sequence. With a scripted provider fetch, the engineer makes a choice, the
 * reviewer DISAGREES with it, and qa reconciles — and each downstream specialist's real
 * prompt is asserted to contain the upstream specialist's real, trust-wrapped output (the
 * H6 handoff made real), so the disagreement genuinely propagates architect→engineer→
 * reviewer→qa. The run reaches a clean terminal contract with every task producing output.
 *
 * Honest scope: this is sequential-chain arbitration (disagreement surfaced and carried
 * forward for reconciliation), not a true critic/reviser loop that sends work back — that
 * topology is deferred. The live-model variant is the
 * team.arbitration.base-chain catalog scenario (opt-in via CONSTRUCT_CERTIFY_LIVE=1).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { runOrchestration } from '../../lib/orchestration/runtime.mjs';
import { runCertificationScenario } from '../../lib/certification/runner.mjs';
import { reviewerReferencesEngineer } from '../../lib/certification/team-arbitration.mjs';

const MODEL = 'anthropic/claude-sonnet-4-6';
const ENV = { CONSTRUCT_MODEL_REASONING: MODEL, CONSTRUCT_MODEL_STANDARD: MODEL, CONSTRUCT_MODEL_FAST: MODEL };

const dirs = [];
function project() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-team-arb-'));
  dirs.push(cwd);
  return cwd;
}
test.after(() => { for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} } });

const homeOverride = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-team-arb-home-'));
const prevHomeOverride = process.env.CONSTRUCT_HOME_OVERRIDE;
process.env.CONSTRUCT_HOME_OVERRIDE = homeOverride;
test.after(() => {
  try { fs.rmSync(homeOverride, { recursive: true, force: true }); } catch {}
  if (prevHomeOverride === undefined) delete process.env.CONSTRUCT_HOME_OVERRIDE;
  else process.env.CONSTRUCT_HOME_OVERRIDE = prevHomeOverride;
});

const REQUEST = 'implement and verify a pagination feature for the results list';
const OUTPUTS = {
  'architect': 'ARCHITECT-DECISION: results must stay per-page revocable; stable ordering under concurrent writes is the invariant.',
  'engineer': 'ENGINEER-IMPL: shipped offset pagination with a 24-hour cache for convenience.',
  'reviewer': 'REVIEWER-CHALLENGE: DISAGREE — offset pagination + a 24-hour cache breaks stable ordering under concurrent writes; flag HIGH, recommend keyset pagination.',
  'qa': 'QA-RECONCILE: added a test asserting ordering stability; the offset-vs-keyset disagreement is unresolved and must be reconciled before merge.',
};

test('the base chain collaborates: a reviewer disagreement propagates from engineer through to qa', async () => {
  const cwd = project();
  const bodies = [];
  // The base chain dispatches architect->engineer->reviewer->qa in a fixed order before any
  // runtime-recruited join fires (joins happen after a task completes), so call index maps
  // deterministically to the base role; later calls (a recruited designer) get generic output.
  const ORDER = ['architect', 'engineer', 'reviewer', 'qa'];
  const fetchImpl = async (_url, opts) => {
    const idx = bodies.length;
    bodies.push(JSON.parse(opts.body));
    const role = ORDER[idx] ?? null;
    const text = role ? OUTPUTS[role] : `SPECIALIST-OUTPUT-${idx + 1}`;
    return { ok: true, json: async () => ({ content: [{ type: 'text', text }] }) };
  };

  const run = await runOrchestration(
    { request: REQUEST, requestedStrategy: 'orchestrated', hostModel: MODEL, fileCount: 4, moduleCount: 2 },
    { env: { ...ENV, ANTHROPIC_API_KEY: 'sk-test' }, cwd, workerBackend: 'provider', fetchImpl },
  );

  // Terminal contract: the run completed and every task produced real output.
  assert.equal(run.status, 'completed');
  const workerProfiles = run.tasks.map((t) => t.workerProfileId);
  // The base chain must be present in order; runtime recruitment (H8) may append extra
  // joins from output signals (e.g. a designer), which is expected, not a failure.
  const baseIdx = ['architect', 'engineer', 'reviewer', 'qa'].map((r) => workerProfiles.indexOf(r));
  assert.ok(baseIdx.every((i) => i >= 0), `base chain present in ${workerProfiles.join(',')}`);
  assert.deepEqual([...baseIdx].sort((a, b) => a - b), baseIdx, 'base chain dispatched in architect->engineer->reviewer->qa order');
  for (const t of run.tasks) {
    assert.equal(t.status, 'done', `${t.workerProfileId} finished`);
    assert.ok(typeof t.output === 'string' && t.output.trim().length > 0, `${t.workerProfileId} produced output`);
  }

  // bodies are captured in dispatch order, so bodies[i] is the prompt for run.tasks[i].
  const promptFor = (workerProfileId) => JSON.stringify(bodies[workerProfiles.indexOf(workerProfileId)]);
  const reviewerPrompt = promptFor('reviewer');
  const qaPrompt = promptFor('qa');

  // Collaboration: the reviewer actually saw the engineer's real, trust-wrapped output.
  assert.match(reviewerPrompt, /## Prior (specialist|Worker Profile) results/i, "the reviewer's prompt carries prior Worker Profile results");
  assert.ok(reviewerPrompt.includes(OUTPUTS['engineer']), "the reviewer's prompt contains the engineer's real output");
  assert.match(reviewerPrompt, /UNTRUSTED:team-authored:(?:Worker Profile|specialist|worker-profile):engineer:/i, "the engineer's output is trust-wrapped in the reviewer's prompt");

  // Propagation: qa saw the reviewer's disagreement, so the arbitration carries forward.
  assert.ok(qaPrompt.includes(OUTPUTS['reviewer']), "qa's prompt contains the reviewer's disagreement");
  assert.match(qaPrompt, /DISAGREE/, "the reviewer's challenge language reaches qa");

  // And qa's own recorded output reconciles rather than silently dropping the conflict.
  const qaOutput = run.tasks.find((t) => t.workerProfileId === 'qa').output;
  assert.match(qaOutput, /reconcile|unresolved/i, 'qa surfaces the unresolved disagreement rather than rubber-stamping');
});

test('reviewerReferencesEngineer detects a shared salient token, not incidental short words', () => {
  assert.equal(reviewerReferencesEngineer('used a token-bucket limiter', 'the token-bucket approach risks bursts'), true);
  assert.equal(reviewerReferencesEngineer('used a token-bucket limiter', 'this is a totally unrelated review of the ui'), false);
});

const LIVE_ENV = { ANTHROPIC_API_KEY: 'sk-test-abcdef0123456789', CONSTRUCT_CERTIFY_LIVE: '1', CONSTRUCT_E2E_REAL_LLM_PROVIDER: 'anthropic' };
function chainFetch(outputsByOrder) {
  let i = 0;
  return async () => {
    const text = outputsByOrder[i] ?? `OUT-${i + 1}`;
    i += 1;
    return { ok: true, json: async () => ({ content: [{ type: 'text', text }] }) };
  };
}

test('the live team-arbitration gate is inconclusive without CONSTRUCT_CERTIFY_LIVE=1', async () => {
  const cwd = project();
  const { run } = await runCertificationScenario('team.arbitration.base-chain', {
    projectDir: cwd, repoRoot: process.cwd(), env: { ANTHROPIC_API_KEY: 'sk-test-abcdef0123456789' }, fetchImpl: chainFetch([]),
  });
  assert.equal(run.verdict.status, 'inconclusive');
  assert.equal(run.verdict.source, 'skipped-provider');
});

test('the live gate passes when the reviewer grounds in and challenges the engineer', async () => {
  const cwd = project();
  const outputs = [
    'ARCHITECT: fairness across tenants is the invariant.',
    'ENGINEER: used a token-bucket limiter with a fixed window.',
    'REVIEWER: the fixed-window token-bucket risks burst clustering — I disagree, recommend a sliding window.',
    'QA: added a fairness test.',
  ];
  const { run } = await runCertificationScenario('team.arbitration.base-chain', {
    projectDir: cwd, repoRoot: process.cwd(), env: LIVE_ENV, fetchImpl: chainFetch(outputs),
  });
  const gate = run.gates.find((g) => g.id === 'team-arbitration-grounding');
  assert.ok(gate, 'the arbitration gate ran');
  assert.equal(gate.pass, true, gate.detail);
  assert.equal(run.verdict.status, 'pass');
});
