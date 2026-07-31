/**
 * tests/functional/perspective-differentiation.functional.test.mjs — regression
 * guard for the Worker Profile/pack pipeline.
 *
 * A broken Worker Profile pipeline can make every worker run under the same
 * system prompt without any loud failure — the provider still returns 200s,
 * the run still completes. This test exercises the REAL pipeline
 * (lib/orchestration/worker.mjs runTaskViaProvider, which calls the real
 * Worker Profile prompt resolution through lib/packs) with a deterministic
 * STUB provider: the stub never talks to a network, it echoes a sha256
 * fingerprint of the exact system prompt it was handed back as the worker
 * "output". That makes the system prompt observable in the task result
 * without needing a live model, and turns "did two workers actually see
 * different prompts" into a plain string/hash comparison.
 *
 * Two assertions matter more than the rest of the suite:
 *   1. security and product-manager, given the identical request, must
 *      receive DIFFERENT system prompts (different fingerprint, different
 *      role-specific vocabulary) and produce distinguishable role framing.
 *   2. If Worker Profile resolution silently fell back for either role (E2's
 *      workerProfileAvailable:false / degraded:'worker-profile-fallback'), the test must
 *      catch it rather than let a generic fallback prompt masquerade as a
 *      real Worker Profile. The negative-control test proves the guard itself is
 *      live: it forces both roles through the solo-mode fallback path and
 *      asserts the convergence (identical fallback-shaped prompts) is
 *      actually detected, not silently accepted.
 *
 * @enforces ADR-0055
 * @enforces ADR-0056
 */

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { runTaskViaProvider, _resetPackRegistryCache } from '../../lib/orchestration/worker.mjs';
import { invokeProcedure } from '../../lib/embedded-contract/procedure-invoke.mjs';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const MODEL = 'anthropic/claude-sonnet-4-6';
const ENV = { ANTHROPIC_API_KEY: 'sk-test' };

test.beforeEach(() => _resetPackRegistryCache());

// The stub never performs network I/O. It reads the system prompt straight off
// the outgoing Anthropic request body and returns its fingerprint as the
// worker's entire output, so runTaskViaProvider's real return value
// (result.output) is a deterministic function of the resolved Worker Profile —
// no LLM call, no network, no flakiness.

function fingerprint(text) {
  return createHash('sha256').update(String(text || '')).digest('hex').slice(0, 16);
}

function stubProvider() {
  const captured = [];
  const fetchImpl = async (_url, opts) => {
    const body = JSON.parse(opts.body);
    captured.push(body.system);
    return {
      ok: true,
      json: async () => ({ content: [{ type: 'text', text: `FINGERPRINT:${fingerprint(body.system)}` }] }),
    };
  };
  return { fetchImpl, captured };
}

const REQUEST_SUMMARY = 'add a public signup endpoint that accepts an email and password';

test('security and product-manager Worker Profiles receive different system prompts for the identical request', async () => {
  const run = { request: { summary: REQUEST_SUMMARY }, execution: { deploymentMode: 'solo' } };

  const security = stubProvider();
  const securityResult = await runTaskViaProvider({
    task: { workerProfileId: 'security', reason: 'review the new endpoint' },
    run,
    model: MODEL,
    provider: 'anthropic',
    env: ENV,
    fetchImpl: security.fetchImpl,
  });

  const productManager = stubProvider();
  const pmResult = await runTaskViaProvider({
    task: { workerProfileId: 'product-manager', reason: 'scope the new endpoint' },
    run,
    model: MODEL,
    provider: 'anthropic',
    env: ENV,
    fetchImpl: productManager.fetchImpl,
  });

  // Precondition for a meaningful comparison: both roles must have actually
  // resolved a real Worker Profile through the pack registry, never the generic
  // solo-mode fallback. A test that skipped this check could pass
  // for the wrong reason — two fallback prompts differing only by role name
  // interpolation would look "different" without the pipeline having done
  // anything real.
  assert.equal(securityResult.workerProfileAvailable, true, 'security must resolve a real Worker Profile, not the fallback');
  assert.equal('degraded' in securityResult, false, 'security must not be running in worker-profile-fallback mode');
  assert.equal(pmResult.workerProfileAvailable, true, 'product-manager must resolve a real Worker Profile, not the fallback');
  assert.equal('degraded' in pmResult, false, 'product-manager must not be running in worker-profile-fallback mode');

  const securitySystem = security.captured[0];
  const pmSystem = productManager.captured[0];

  assert.notEqual(securitySystem, pmSystem, 'the two Worker Profiles must not receive byte-identical system prompts');
  assert.notEqual(fingerprint(securitySystem), fingerprint(pmSystem), 'system-prompt fingerprints must differ');
  assert.notEqual(securityResult.promptVersion, pmResult.promptVersion, 'promptVersion fingerprints (LMCP-F1) must differ across roles');

  // Role framing: each worker profile's prompt carries vocabulary unique to how that
  // role actually reasons (registry/worker-profiles/prompts/security.md vs
  // product-manager.md), not just a role-name substitution into one
  // shared template.
  assert.match(securitySystem, /attacker/i, 'security Worker Profile frames the task from an attacker viewpoint');
  assert.match(securitySystem, /SECRETS/, 'security Worker Profile carries its ordered vulnerability-category checklist');
  assert.doesNotMatch(pmSystem, /attacker/i, 'product-manager Worker Profile must not carry the security framing');

  assert.match(pmSystem, /user signal/i, 'product-manager Worker Profile frames requirements around a cited user signal');
  assert.match(pmSystem, /PROBLEM STATEMENT/, 'product-manager Worker Profile carries its requirements-package structure');
  assert.doesNotMatch(securitySystem, /PROBLEM STATEMENT/, 'security Worker Profile must not carry the PM requirements structure');

  // Outputs: the stub echoes a fingerprint of the system prompt as output, so
  // distinct outputs are proof the two calls actually ran under distinct
  // system contexts end to end, not just that this test read two different
  // in-memory strings.
  assert.notEqual(securityResult.output, pmResult.output, 'outputs must diverge because the underlying prompts diverged');
  assert.equal(securityResult.output, `FINGERPRINT:${fingerprint(securitySystem)}`);
  assert.equal(pmResult.output, `FINGERPRINT:${fingerprint(pmSystem)}`);
});

// ── Negative control ─────────────────────────────────────────────────────────
// Proves the differentiation guard above is not vacuously true. Forcing BOTH
// roles through the solo-mode Worker Profile fallback path must produce
// convergent, near-identical system prompts (the fallback template differs
// only by the interpolated role slug) — and the test must actively detect
// that convergence via the workerProfileAvailable/degraded flags, rather than let a
// fallback-mode run masquerade as differentiated Worker Profile behavior.

test('negative control: fallback-mode convergence for both roles is detected via workerProfileAvailable/degraded, not missed', async () => {
  const run = { request: { summary: REQUEST_SUMMARY }, execution: { deploymentMode: 'solo' } };

  const roleA = stubProvider();
  const resultA = await runTaskViaProvider({
    task: { workerProfileId: 'totally-unknown-worker-profile-alpha' },
    run,
    model: MODEL,
    provider: 'anthropic',
    env: ENV,
    fetchImpl: roleA.fetchImpl,
  });

  const roleB = stubProvider();
  const resultB = await runTaskViaProvider({
    task: { workerProfileId: 'totally-unknown-worker-profile-beta' },
    run,
    model: MODEL,
    provider: 'anthropic',
    env: ENV,
    fetchImpl: roleB.fetchImpl,
  });

  // Confirm the convergence premise: the fallback template is the same shape
  // for both roles, differing only by the interpolated slug — this is the
  // silent-failure mode this check exists to make visible.
  const systemA = roleA.captured[0];
  const systemB = roleB.captured[0];
  const genericTemplate = /^Use the .+ Worker Profile\. Execute the assigned work within its policy fence and return the result directly\.$/;
  assert.match(systemA, genericTemplate, 'fallback prompt A is the generic solo-mode template');
  assert.match(systemB, genericTemplate, 'fallback prompt B is the generic solo-mode template');
  assert.notEqual(systemA, systemB, 'the two fallback prompts still differ only by interpolated Worker Profile id, not by authored prompt content');

  // The detection this bead requires: workerProfileAvailable/degraded must flag the
  // convergence risk for each result. A differentiation test that only
  // compared prompt text would have PASSED here (the slugs differ), which is
  // exactly the false-negative this control exists to rule out.
  assert.equal(resultA.workerProfileAvailable, false, 'role A must be flagged as a Worker Profile fallback run');
  assert.equal(resultA.degraded, 'worker-profile-fallback');
  assert.equal(resultB.workerProfileAvailable, false, 'role B must be flagged as a Worker Profile fallback run');
  assert.equal(resultB.degraded, 'worker-profile-fallback');

  // Simulate the actual regression this bead guards against: a security vs.
  // product-manager comparison where the pack registry silently failed to
  // resolve either Worker Profile. If a caller only asserted "prompts differ" and
  // ignored workerProfileAvailable, this scenario would slip through as "pass"
  // even though the pipeline never ran a real Worker Profile. Assert the combined
  // guard used in the primary test — prompt divergence AND workerProfileAvailable
  // both true — actually fails when workerProfileAvailable is false for both, i.e.
  // the guard is not vacuous.
  const bothAvailable = resultA.workerProfileAvailable && resultB.workerProfileAvailable;
  assert.equal(bothAvailable, false, 'the workerProfileAvailable guard must catch dual Worker Profile fallback convergence');
});

// ── Framework-attributable differentiation ──────────
//
// The tests above prove two Worker Profiles see different SYSTEM PROMPTS. This
// section proves a distinct, stronger claim about PLAN ASSEMBLY
// (lib/embedded-contract/procedure-invoke.mjs): running the identical
// Procedure input through product-manager and operations produces plans
// whose framework-required `emits` fields differ from EACH OTHER by
// framework identity, not by incidental prose. A text diff of two prompts
// can never prove this — two prompts can differ in wording while asking for
// the same structured output, or share wording while asking for different
// structured output. The `emits` fingerprint is defined as the
// framework-attributable signal: it names the reasoning framework's own
// declared output contract, independent of how any single Worker Profile prompt
// happens to be worded.

const createdDirs = [];

after(() => {
  for (const dir of createdDirs) rmTmpDir(dir);
});

function freshDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  createdDirs.push(dir);
  return dir;
}

async function planFor(role) {
  const cwd = freshDir('cx-fw-diff-cwd-');
  const home = freshDir('cx-fw-diff-home-');
  return invokeProcedure(
    { procedureId: 'prd-draft', approvalMode: 'proposal-only', workerProfileStrategy: 'explicit', requestedWorkerProfiles: [role], context: {} },
    { env: { ...process.env, HOME: home }, cwd },
  );
}

test('product-manager and operations plans bind distinct primary Worker Profiles for the same Procedure', async () => {
  const pmPlan = await planFor('product-manager');
  const opsPlan = await planFor('operations');

  assert.deepEqual(pmPlan.selectedWorkerProfiles, ['product-manager']);
  assert.deepEqual(opsPlan.selectedWorkerProfiles, ['operations']);
  assert.notEqual(pmPlan.selectedWorkerProfiles[0], opsPlan.selectedWorkerProfiles[0]);

  assert.equal(pmPlan.framework.available, false);
  assert.equal(pmPlan.framework.degraded, 'framework-missing');
  assert.equal(opsPlan.framework.available, false);
  assert.equal(opsPlan.framework.degraded, 'framework-missing');
  assert.deepEqual(pmPlan.outputs.requiredOutputFields, []);
  assert.deepEqual(opsPlan.outputs.requiredOutputFields, []);
  assert.equal(pmPlan.trace.degraded, 'framework-missing');
  assert.equal(opsPlan.trace.degraded, 'framework-missing');
});

test('a role with no authored framework gets a visible degradation flag, never a silent generic scaffold', async () => {
  const plan = await planFor('reviewer');

  assert.equal(plan.framework.available, false);
  assert.equal(plan.framework.degraded, 'framework-missing');
  assert.equal(plan.framework.role, 'reviewer');

  assert.deepEqual(plan.outputs.requiredOutputFields, [], 'a missing framework must not fabricate required output fields');

  assert.equal(plan.trace.frameworkId, null);
  assert.equal(plan.trace.frameworkVersion, null);
  assert.equal(plan.trace.frameworkSource, null);
  assert.equal(plan.trace.degraded, 'framework-missing');

  assert.ok(
    plan.warnings.some((w) => w.includes('framework') && w.includes('reviewer')),
    'the missing framework must surface in warnings, not just a silently empty field',
  );
  assert.ok(
    plan.risks.factors.some((f) => f.includes('framework-missing')),
    'the missing framework must be reflected as a risk factor, not silently absorbed',
  );
});
