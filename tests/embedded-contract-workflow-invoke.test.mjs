/**
 * tests/embedded-contract-workflow-invoke.test.mjs — unit tests for workflow invocation.
 *
 * Pins workflow-type validation, the three role strategies, model resolution
 * surfacing, evidence satisfied/missing accounting, the traceId toggle, and the
 * approval-mode write gate (proposal-only writes nothing; allow-durable-write
 * records an observation; team mode flags the write as audited). Durable cases
 * use an isolated tmpdir cwd; the approval case suppresses the home-dir write
 * via CONSTRUCT_ROLES=off so the test never touches real state.
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

test('unknown workflowType returns a structured error', async () => {
  const r = await invokeWorkflow({ workflowType: 'nope' }, { env: {} });
  assert.equal(r.status, 'error');
  assert.equal(r.errors[0].code, 'UNKNOWN_WORKFLOW_TYPE');
  assert.deepEqual(r.selectedRoles, []);
});

test('auto strategy uses the workflow default chain and resolves a model', async () => {
  const r = await invokeWorkflow({ workflowType: 'architecture-review', approvalMode: 'proposal-only' }, { env: {} });
  assert.equal(r.status, 'proposed');
  assert.deepEqual(r.selectedRoles, ['architect', 'security', 'devil-advocate']);
  assert.equal(r.roleStrategy, 'auto');
  assert.ok(r.modelResolution.selectedModel, 'model resolution surfaced');
  assert.equal(r.skillsApplied.length > 0, true);
  assert.equal(r.roleRationale.length, r.selectedRoles.length);
});

test('explicit strategy uses requested roles; unknown roles are dropped with a warning', async () => {
  const r = await invokeWorkflow({ workflowType: 'prd-draft', roleStrategy: 'explicit', requestedRoles: ['architect', 'ghost'], approvalMode: 'proposal-only' }, { env: {} });
  assert.deepEqual(r.selectedRoles, ['architect']);
  assert.ok(r.warnings.some((w) => w.includes('ghost')));
});

test('constrained strategy intersects the default chain with requested roles', async () => {
  const r = await invokeWorkflow({ workflowType: 'architecture-review', roleStrategy: 'constrained', requestedRoles: ['architect', 'security'], approvalMode: 'proposal-only' }, { env: {} });
  assert.deepEqual(r.selectedRoles, ['architect', 'security']);
  assert.ok(r.warnings.some((w) => w.includes('devil-advocate')));
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
  assert.equal(fs.existsSync(path.join(cwd, '.cx', 'observations')), false);
});

test('allow-durable-write records an observation; team mode marks it audited', async () => {
  const cwd = freshCwd();
  const r = await invokeWorkflow({ workflowType: 'evidence-ingest', approvalMode: 'allow-durable-write' }, { env: { CONSTRUCT_DEPLOYMENT_MODE: 'team' }, cwd });
  assert.equal(r.status, 'recorded');
  assert.equal(r.durableWritesPerformed.length, 1);
  assert.equal(r.durableWritesPerformed[0].kind, 'observation');
  assert.equal(r.durableWritesPerformed[0].audited, true);
  assert.ok(fs.existsSync(path.join(cwd, '.cx', 'observations')));
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
