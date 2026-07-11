/**
 * tests/embedded-contract-workflow-invoke.test.mjs — unit tests for workflow invocation.
 *
 * Pins workflow-type validation, the three role strategies, model resolution
 * surfacing, evidence satisfied/missing accounting, the traceId toggle, and the
 * approval-mode write gate (proposal-only writes nothing; allow-durable-write
 * records an observation; team mode flags the write as audited). Durable cases
 * use an isolated tmpdir cwd; the approval case suppresses the home-dir write
 * via CONSTRUCT_ROLES=off so the test never touches real state.
 *
 * The durable-write case resolves observation-store state through the
 * machine-scoped state root (ADR-0066), keyed by a hash of the tmp cwd — so
 * CX_HOME_OVERRIDE is pinned for the whole file to keep that write off the
 * real developer machine's $HOME.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';

import { invokeWorkflow } from '../lib/embedded-contract/workflow-invoke.mjs';

const tmpDirs = [];
function freshCwd() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-ecl-wf-'));
  tmpDirs.push(dir);
  return dir;
}
after(() => {
  for (const dir of tmpDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
});

// The allow-durable-write case records an observation through the machine-scoped
// state root (ADR-0066, lib/observation-store.mjs -> resolveStateDir), so
// CX_HOME_OVERRIDE is pinned for the whole file to keep that write off the real
// developer machine's ~/.construct/projects.

const homeOverride = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-ecl-wf-home-'));
const prevHomeOverride = process.env.CX_HOME_OVERRIDE;
process.env.CX_HOME_OVERRIDE = homeOverride;
after(() => {
  try { fs.rmSync(homeOverride, { recursive: true, force: true }); } catch {}
  if (prevHomeOverride === undefined) delete process.env.CX_HOME_OVERRIDE;
  else process.env.CX_HOME_OVERRIDE = prevHomeOverride;
});

test('unknown workflowType returns a structured error', async () => {
  const r = await invokeWorkflow({ workflowType: 'nope' }, { env: {} });
  assert.equal(r.status, 'error');
  assert.equal(r.errors[0].code, 'UNKNOWN_WORKFLOW_TYPE');
  assert.deepEqual(r.selectedRoles, []);
});

test('auto strategy uses the workflow default chain and resolves a model', async () => {
  // ADR-0027: Construct ships no implicit defaults. The architecture-review
  // workflow hints toward the reasoning tier; configure it via env so model
  // resolution surfaces a concrete selection (rather than the structured
  // config-error path covered by tests/embedded-contract-model-resolve.test.mjs).
  const r = await invokeWorkflow(
    { workflowType: 'architecture-review', approvalMode: 'proposal-only' },
    { env: { CX_MODEL_REASONING: 'anthropic/claude-opus-4-6' } },
  );
  assert.equal(r.status, 'proposed');
  assert.deepEqual(r.selectedRoles, ['architect', 'security', 'reviewer']);
  assert.equal(r.roleStrategy, 'auto');
  assert.ok(r.modelResolution.selectedModel, 'model resolution surfaced');
  assert.equal(r.skillsApplied.length > 0, true);
  assert.equal(r.roleRationale.length, r.selectedRoles.length);
});

test('auto strategy surfaces a structured model-resolution error when no tier is configured', async () => {
  // Companion to the above: with no env override and no registry primary, the
  // workflow still produces a proposal (roles, skills, rationale) but the
  // modelResolution field carries a config-error so callers can surface a
  // remediation hint instead of seeing a silent null.
  const r = await invokeWorkflow(
    { workflowType: 'architecture-review', approvalMode: 'proposal-only' },
    { env: {} },
  );
  assert.equal(r.status, 'proposed');
  assert.equal(r.modelResolution.selectedModel, null);
  assert.equal(r.modelResolution.resolutionSource, 'config-error');
  assert.ok(r.modelResolution.error?.remediation, 'remediation hint surfaced');
});

test('explicit strategy uses requested roles; unknown roles are dropped with a warning', async () => {
  const r = await invokeWorkflow({ workflowType: 'prd-draft', roleStrategy: 'explicit', requestedRoles: ['architect', 'ghost'], approvalMode: 'proposal-only' }, { env: {} });
  assert.deepEqual(r.selectedRoles, ['architect']);
  assert.ok(r.warnings.some((w) => w.includes('ghost')));
});

test('constrained strategy intersects the default chain with requested roles', async () => {
  const r = await invokeWorkflow({ workflowType: 'architecture-review', roleStrategy: 'constrained', requestedRoles: ['architect', 'security'], approvalMode: 'proposal-only' }, { env: {} });
  assert.deepEqual(r.selectedRoles, ['architect', 'security']);
  assert.ok(r.warnings.some((w) => w.includes('reviewer')));
});

test('evidence requirements are satisfied only by present context keys', async () => {
  const r = await invokeWorkflow({ workflowType: 'proposal-review', context: {}, approvalMode: 'proposal-only' }, { env: {} });
  assert.ok(Array.isArray(r.evidence.requirements));
  assert.deepEqual(r.evidence.satisfied, []);
  assert.deepEqual(r.evidence.missing, r.evidence.requirements);
});

test('trace=false yields a null traceId', async () => {
  const r = await invokeWorkflow({ workflowType: 'prd-draft', approvalMode: 'proposal-only', trace: false }, { env: {} });
  assert.equal(r.traceId, null);
});

test('proposal-only performs no durable write', async () => {
  const cwd = freshCwd();
  const r = await invokeWorkflow({ workflowType: 'evidence-ingest', approvalMode: 'proposal-only' }, { env: {}, cwd });
  assert.equal(r.status, 'proposed');
  assert.deepEqual(r.durableWritesPerformed, []);
  assert.equal(fs.existsSync(path.join(cwd, '.construct', 'observations')), false);
});

test('allow-durable-write records an observation; team mode marks it audited', async () => {
  const cwd = freshCwd();
  const r = await invokeWorkflow({ workflowType: 'evidence-ingest', approvalMode: 'allow-durable-write' }, { env: { CONSTRUCT_DEPLOYMENT_MODE: 'team' }, cwd });
  assert.equal(r.status, 'recorded');
  assert.equal(r.durableWritesPerformed.length, 1);
  assert.equal(r.durableWritesPerformed[0].kind, 'observation');
  assert.equal(r.durableWritesPerformed[0].audited, true);
  assert.ok(fs.existsSync(path.join(cwd, '.construct', 'observations')));
});

test('requires-human-approval gates writes and records an approval request', async () => {
  const cwd = freshCwd();
  const prev = process.env.CONSTRUCT_ROLES;
  process.env.CONSTRUCT_ROLES = 'off';
  try {
    const r = await invokeWorkflow({ workflowType: 'risk-review', approvalMode: 'requires-human-approval' }, { env: {}, cwd });
    assert.equal(r.status, 'awaiting-approval');
    assert.equal(r.requiresApproval, true);
    assert.deepEqual(r.durableWritesPerformed, []);
  } finally {
    if (prev === undefined) delete process.env.CONSTRUCT_ROLES; else process.env.CONSTRUCT_ROLES = prev;
  }
});

const EXEC_ENV = { CX_MODEL_REASONING: 'anthropic/claude-sonnet-4-6', CX_MODEL_STANDARD: 'anthropic/claude-sonnet-4-6', CX_MODEL_FAST: 'anthropic/claude-sonnet-4-6' };

test('invocation reports a planned execution block (descriptive, not enforced)', async () => {
  const r = await invokeWorkflow(
    { workflowType: 'architecture-review', approvalMode: 'proposal-only', constructStrategy: 'orchestrated', hostModel: 'anthropic/claude-sonnet-4-6' },
    { env: EXEC_ENV, cwd: freshCwd() },
  );
  assert.ok(r.execution, 'execution block present');
  assert.equal(r.execution.executionMode, 'construct-orchestrated');
  assert.equal(r.execution.effectiveStrategy, 'orchestrated');
  assert.ok(r.execution.constructCapabilitiesActive.includes('personas'));
  assert.match(r.execution.semantics, /does not observe host execution/i);
});

test('constructStrategy=prompt-only yields a prompt-only execution block', async () => {
  const r = await invokeWorkflow(
    { workflowType: 'evidence-ingest', approvalMode: 'proposal-only', constructStrategy: 'prompt-only' },
    { env: EXEC_ENV, cwd: freshCwd() },
  );
  assert.equal(r.execution.executionMode, 'construct-prompt-only');
  assert.deepEqual(r.execution.constructCapabilitiesActive, ['prompt-envelope']);
});
