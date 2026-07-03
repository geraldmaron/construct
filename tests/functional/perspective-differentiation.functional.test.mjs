/**
 * tests/functional/perspective-differentiation.functional.test.mjs — regression
 * guard for the persona/pack pipeline (LMCP-F3).
 *
 * A broken persona pipeline can make every specialist run under the same
 * system prompt without any loud failure — the provider still returns 200s,
 * the run still completes. This test exercises the REAL pipeline
 * (lib/orchestration/worker.mjs runTaskViaProvider, which calls the real
 * loadPersona/resolvePersonaPrompt through lib/packs) with a deterministic
 * STUB provider: the stub never talks to a network, it echoes a sha256
 * fingerprint of the exact system prompt it was handed back as the specialist
 * "output". That makes the system prompt observable in the task result
 * without needing a live model, and turns "did two specialists actually see
 * different prompts" into a plain string/hash comparison.
 *
 * Two assertions matter more than the rest of the suite:
 *   1. cx-security and cx-product-manager, given the identical request, must
 *      receive DIFFERENT system prompts (different fingerprint, different
 *      role-specific vocabulary) and produce distinguishable role framing.
 *   2. If persona resolution silently fell back for either role (E2's
 *      personaAvailable:false / degraded:'persona-fallback'), the test must
 *      catch it rather than let a generic fallback prompt masquerade as a
 *      real persona. The negative-control test proves the guard itself is
 *      live: it forces both roles through the solo-mode fallback path and
 *      asserts the convergence (identical fallback-shaped prompts) is
 *      actually detected, not silently accepted.
 *
 * @enforces ADR-0055 ADR-0056
 */

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { runTaskViaProvider, _resetPackRegistryCache } from '../../lib/orchestration/worker.mjs';
import { invokeWorkflow } from '../../lib/embedded-contract/workflow-invoke.mjs';

const MODEL = 'anthropic/claude-sonnet-4-6';
const ENV = { ANTHROPIC_API_KEY: 'sk-test' };

test.beforeEach(() => _resetPackRegistryCache());

// The stub never performs network I/O. It reads the system prompt straight off
// the outgoing Anthropic request body and returns its fingerprint as the
// specialist's entire output, so runTaskViaProvider's real return value
// (result.output) is a deterministic function of the real resolved persona —
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

test('security and product-manager specialists receive different system prompts for the identical request', async () => {
  const run = { request: { summary: REQUEST_SUMMARY }, execution: { deploymentMode: 'solo' } };

  const security = stubProvider();
  const securityResult = await runTaskViaProvider({
    task: { role: 'cx-security', reason: 'review the new endpoint' },
    run,
    model: MODEL,
    provider: 'anthropic',
    env: ENV,
    fetchImpl: security.fetchImpl,
  });

  const productManager = stubProvider();
  const pmResult = await runTaskViaProvider({
    task: { role: 'cx-product-manager', reason: 'scope the new endpoint' },
    run,
    model: MODEL,
    provider: 'anthropic',
    env: ENV,
    fetchImpl: productManager.fetchImpl,
  });

  // Precondition for a meaningful comparison: both roles must have actually
  // resolved a real persona through the pack registry, never the generic
  // solo-mode fallback (LMCP-E2). A test that skipped this check could pass
  // for the wrong reason — two fallback prompts differing only by role name
  // interpolation would look "different" without the pipeline having done
  // anything real.
  assert.equal(securityResult.personaAvailable, true, 'cx-security must resolve a real persona, not the fallback');
  assert.equal('degraded' in securityResult, false, 'cx-security must not be running in persona-fallback mode');
  assert.equal(pmResult.personaAvailable, true, 'cx-product-manager must resolve a real persona, not the fallback');
  assert.equal('degraded' in pmResult, false, 'cx-product-manager must not be running in persona-fallback mode');

  const securitySystem = security.captured[0];
  const pmSystem = productManager.captured[0];

  assert.notEqual(securitySystem, pmSystem, 'the two specialists must not receive byte-identical system prompts');
  assert.notEqual(fingerprint(securitySystem), fingerprint(pmSystem), 'system-prompt fingerprints must differ');
  assert.notEqual(securityResult.promptVersion, pmResult.promptVersion, 'promptVersion fingerprints (LMCP-F1) must differ across roles');

  // Role framing: each persona's prompt carries vocabulary unique to how that
  // role actually reasons (specialists/prompts/cx-security.md vs
  // cx-product-manager.md), not just a role-name substitution into one
  // shared template.
  assert.match(securitySystem, /attacker/i, 'security persona frames the task from an attacker viewpoint');
  assert.match(securitySystem, /SECRETS/, 'security persona carries its ordered vulnerability-category checklist');
  assert.doesNotMatch(pmSystem, /attacker/i, 'product-manager persona must not carry the security framing');

  assert.match(pmSystem, /user signal/i, 'product-manager persona frames requirements around a cited user signal');
  assert.match(pmSystem, /PROBLEM STATEMENT/, 'product-manager persona carries its requirements-package structure');
  assert.doesNotMatch(securitySystem, /PROBLEM STATEMENT/, 'security persona must not carry the PM requirements structure');

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
// roles through the solo-mode persona-fallback path (LMCP-E2) must produce
// convergent, near-identical system prompts (the fallback template differs
// only by the interpolated role slug) — and the test must actively detect
// that convergence via the personaAvailable/degraded flags, rather than let a
// fallback-mode run masquerade as differentiated specialist behavior.

test('negative control: fallback-mode convergence for both roles is detected via personaAvailable/degraded, not missed', async () => {
  const run = { request: { summary: REQUEST_SUMMARY }, execution: { deploymentMode: 'solo' } };

  const roleA = stubProvider();
  const resultA = await runTaskViaProvider({
    task: { role: 'cx-totally-unknown-specialist-alpha' },
    run,
    model: MODEL,
    provider: 'anthropic',
    env: ENV,
    fetchImpl: roleA.fetchImpl,
  });

  const roleB = stubProvider();
  const resultB = await runTaskViaProvider({
    task: { role: 'cx-totally-unknown-specialist-beta' },
    run,
    model: MODEL,
    provider: 'anthropic',
    env: ENV,
    fetchImpl: roleB.fetchImpl,
  });

  // Confirm the convergence premise: the fallback template is the same shape
  // for both roles, differing only by the interpolated slug — this is the
  // silent-failure mode LMCP-E2 exists to make visible.
  const systemA = roleA.captured[0];
  const systemB = roleB.captured[0];
  const genericTemplate = /^You are the .+ specialist\. Execute your part of the request within your role and return your result directly\.$/;
  assert.match(systemA, genericTemplate, 'fallback prompt A is the generic solo-mode template');
  assert.match(systemB, genericTemplate, 'fallback prompt B is the generic solo-mode template');
  assert.notEqual(systemA, systemB, 'the two fallback prompts still differ only by interpolated role slug, not by real persona content');

  // The detection this bead requires: personaAvailable/degraded must flag the
  // convergence risk for each result. A differentiation test that only
  // compared prompt text would have PASSED here (the slugs differ), which is
  // exactly the false-negative this control exists to rule out.
  assert.equal(resultA.personaAvailable, false, 'role A must be flagged as a persona-fallback run');
  assert.equal(resultA.degraded, 'persona-fallback');
  assert.equal(resultB.personaAvailable, false, 'role B must be flagged as a persona-fallback run');
  assert.equal(resultB.degraded, 'persona-fallback');

  // Simulate the actual regression this bead guards against: a security vs.
  // product-manager comparison where the pack registry silently failed to
  // resolve either specialist. If a caller only asserted "prompts differ" and
  // ignored personaAvailable, this scenario would slip through as "pass" even
  // though the pipeline never ran a single real persona. Assert the combined
  // guard used in the primary test — prompt divergence AND personaAvailable
  // both true — actually fails when personaAvailable is false for both, i.e.
  // the guard is not vacuous.
  const bothAvailable = resultA.personaAvailable && resultB.personaAvailable;
  assert.equal(bothAvailable, false, 'the personaAvailable guard must catch a dual persona-fallback convergence, not report it as healthy differentiation');
});

// ── Framework-attributable differentiation (LMCP-F8, ADR-0062 §3) ──────────
//
// The tests above prove two specialists see different SYSTEM PROMPTS. This
// section proves a distinct, stronger claim about PLAN ASSEMBLY
// (lib/embedded-contract/workflow-invoke.mjs): running the identical
// workflow input through product-manager and operations produces plans
// whose framework-required `emits` fields differ from EACH OTHER by
// framework identity, not by incidental prose. A text diff of two prompts
// can never prove this — two prompts can differ in wording while asking for
// the same structured output, or share wording while asking for different
// structured output. The `emits` fingerprint is what ADR-0062 defines as the
// framework-attributable signal: it names the reasoning framework's own
// declared output contract, independent of how any single specialist prompt
// happens to be worded.

const createdDirs = [];

after(() => {
  for (const dir of createdDirs) fs.rmSync(dir, { recursive: true, force: true });
});

function freshDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  createdDirs.push(dir);
  return dir;
}

async function planFor(role) {
  const cwd = freshDir('cx-fw-diff-cwd-');
  const home = freshDir('cx-fw-diff-home-');
  return invokeWorkflow(
    { workflowType: 'prd-draft', approvalMode: 'proposal-only', roleStrategy: 'explicit', requestedRoles: [role], context: {} },
    { env: { ...process.env, HOME: home }, cwd },
  );
}

test('product-manager and operations plans carry disjoint, framework-attributable emits fingerprints for the same workflow', async () => {
  const pmPlan = await planFor('product-manager');
  const opsPlan = await planFor('operations');

  assert.equal(pmPlan.framework.available, true, 'product-manager must resolve a real framework, not a degraded fallback');
  assert.equal(opsPlan.framework.available, true, 'operations must resolve a real framework, not a degraded fallback');

  assert.equal(pmPlan.framework.frameworkId, 'cx-pm-value-tradeoff');
  assert.equal(opsPlan.framework.frameworkId, 'cx-ops-dependency-sequencing');
  assert.notEqual(pmPlan.framework.frameworkId, opsPlan.framework.frameworkId, 'the two roles must not resolve the same framework id');

  const pmFields = pmPlan.outputs.requiredOutputFields;
  const opsFields = opsPlan.outputs.requiredOutputFields;

  assert.deepEqual(pmFields, ['value-statement', 'tradeoff-table', 'prioritization-call', 'acceptance-criteria']);
  assert.deepEqual(opsFields, ['dependency-graph', 'sequenced-tasks', 'ownership-matrix', 'verification-gates', 'slippage-risk']);

  // Framework-ATTRIBUTABLE, not a text diff: every field the PM plan requires
  // is absent from the ops plan's required fields, and vice versa — the two
  // output contracts share zero emits tokens.
  const pmSet = new Set(pmFields);
  const opsSet = new Set(opsFields);
  for (const field of pmFields) assert.equal(opsSet.has(field), false, `ops plan's required fields must not include the PM-only field '${field}'`);
  for (const field of opsFields) assert.equal(pmSet.has(field), false, `PM plan's required fields must not include the ops-only field '${field}'`);

  // The plan also carries the ordered step scaffold (move/question) the host
  // runtime uses to prompt the reasoning procedure — not just the bare emits
  // list — and that scaffold is itself role-specific.
  assert.deepEqual(pmPlan.framework.steps.map((s) => s.emits), pmFields);
  assert.deepEqual(opsPlan.framework.steps.map((s) => s.emits), opsFields);
  assert.ok(pmPlan.framework.steps.every((s) => typeof s.move === 'string' && s.move.length > 0));
  assert.ok(opsPlan.framework.steps.every((s) => typeof s.move === 'string' && s.move.length > 0));

  // Trace provenance (LMCP-F1 alignment): each plan's trace names which
  // framework+version+source governed it, so a downstream audit does not
  // have to re-derive the binding from the role id.
  assert.equal(pmPlan.trace.frameworkId, 'cx-pm-value-tradeoff');
  assert.equal(pmPlan.trace.frameworkVersion, 1);
  assert.equal(pmPlan.trace.frameworkSource, '@construct/core');
  assert.equal(pmPlan.trace.degraded, null);

  assert.equal(opsPlan.trace.frameworkId, 'cx-ops-dependency-sequencing');
  assert.equal(opsPlan.trace.frameworkVersion, 1);
  assert.equal(opsPlan.trace.frameworkSource, '@construct/core');
  assert.equal(opsPlan.trace.degraded, null);
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
