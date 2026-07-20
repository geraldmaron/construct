/**
 * tests/orchestration-host-contract-revalidation.test.mjs — construct-72gqn.12 (H6c).
 *
 * submitHostTaskResult (lib/orchestration/runtime.mjs) runs
 * applyResearchEvidenceGate on a host-reported result — the least-verified
 * execution path (self-reported, never independently confirmed by
 * Construct), and the riskiest boundary for contract and
 * binary-postcondition enforcement to actually fire. Pins that it now
 * reuses lib/orchestration/worker.mjs's enforceOutputHandoff (the same
 * function the provider path uses, construct-72gqn.11) at the
 * host-result-submission boundary: a submitted result's outputPacket
 * auto-populates from the real submitted text, the contract disambiguates by
 * the actually-adjacent dispatched task, a real violation is logged and
 * rides the task as contractStatus/contractViolations, and none of it
 * degrades the run — matching the provider-path warn-mode contract exactly.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { planRun, executeRun, submitHostTaskResult } from '../lib/orchestration/runtime.mjs';
import { resolveRunStore } from '../lib/orchestration/store.mjs';
import { violationLogPath } from '../lib/contracts/violation-log.mjs';

const MODEL = 'anthropic/claude-sonnet-4-6';
const ENV = { CONSTRUCT_MODEL_REASONING: MODEL, CONSTRUCT_MODEL_STANDARD: MODEL, CONSTRUCT_MODEL_FAST: MODEL };

const dirs = [];
function project() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-host-contract-'));
  dirs.push(cwd);
  return cwd;
}
test.after(() => { for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} } });

const homeOverride = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-host-contract-home-'));
const prevHomeOverride = process.env.CONSTRUCT_HOME_OVERRIDE;
process.env.CONSTRUCT_HOME_OVERRIDE = homeOverride;
test.after(() => {
  try { fs.rmSync(homeOverride, { recursive: true, force: true }); } catch {}
  if (prevHomeOverride === undefined) delete process.env.CONSTRUCT_HOME_OVERRIDE;
  else process.env.CONSTRUCT_HOME_OVERRIDE = prevHomeOverride;
});

function readViolations(cwd) {
  const file = violationLogPath(cwd);
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

// product-manager-to-architect is the surviving producer→consumer contract with
// explicit output validation in the 2.0 capability registry (engineer-to-qa was
// removed). Same adjacent-task / enforceOutputHandoff mechanics as before.

const CONTRACT_ID = 'product-manager-to-architect';

async function twoTaskHostRun(cwd) {
  const planned = await planRun(
    { request: 'draft and review a release plan', requestedStrategy: 'orchestrated', hostModel: MODEL, host: 'OpenCode', fileCount: 4, moduleCount: 2 },
    { env: ENV, cwd },
  );
  planned.tasks = ['product-manager', 'architect'].map((workerProfileId, seq) => ({
    id: `t${seq + 1}`, seq, workerProfileId, reason: null, handoffContract: null,
    outputContractId: seq === 0 ? CONTRACT_ID : null,
    status: 'queued', executor: null, output: null, reasoning: null, error: null, startedAt: null, finishedAt: null,
  }));
  const { store } = resolveRunStore({ config: {}, env: ENV, cwd });
  await store.saveRun(planned);
  return executeRun(cwd, planned.runId, { env: ENV, workerBackend: 'host' });
}

test('a host-reported result with contract-failing free text is recorded ok+warned, never blocked-contract or degraded', async () => {
  const cwd = project();
  const run = await twoTaskHostRun(cwd);

  const { run: afterFirst } = await submitHostTaskResult(cwd, run.runId, 't1', { output: 'Problem: release cadence is unreliable. Functional requirements listed.' }, { env: ENV });
  const pmTask = afterFirst.tasks.find((t) => t.id === 't1');

  assert.equal(pmTask.contractId, CONTRACT_ID, 'explicit outputContractId pins the handoff contract on the host path');
  assert.equal(pmTask.contractStatus, 'ok', 'warn mode never reports blocked-contract for an auto-populated packet');
  assert.ok(Array.isArray(pmTask.contractViolations) && pmTask.contractViolations.length > 0, 'the real violation still rides the task, not silently dropped');
  assert.notEqual(afterFirst.status, 'degraded', 'a warn-mode contract violation must never degrade the run');

  const violations = readViolations(cwd);
  assert.equal(violations.length, 1);
  assert.equal(violations[0].contractId, CONTRACT_ID);
  assert.equal(violations[0].direction, 'output');
  assert.equal(violations[0].runId, run.runId);
});

test('a caller-supplied outputPacket at submitHostTaskResult keeps block enforcement (LMCP-F2 opt-in preserved)', async () => {
  const cwd = project();
  const run = await twoTaskHostRun(cwd);
  // Pre-populate and persist the outputPacket before submission, as a caller
  // who wants strict validation would — auto-population must never clobber
  // this. submitHostTaskResult reloads the run fresh from the store, so the
  // packet must actually be saved, not just set on this in-memory object.
  run.tasks.find((t) => t.id === 't1').outputPacket = { problem: 'The release workflow is unreliable.' };
  const { store } = resolveRunStore({ config: {}, env: ENV, cwd });
  await store.saveRun(run);

  const { run: afterFirst } = await submitHostTaskResult(cwd, run.runId, 't1', { output: 'engineer output' }, { env: ENV });
  const updated = afterFirst.tasks.find((t) => t.id === 't1');
  assert.deepEqual(updated.outputPacket, { problem: 'The release workflow is unreliable.' }, 'the caller-supplied packet is never overwritten with the submitted free text');
  assert.equal(updated.contractStatus, 'blocked-contract', 'block enforcement genuinely fires for a caller-supplied packet, unlike the auto-populated warn-mode case above');
});

test('the run completes cleanly through both boundaries: host re-materialization (H6a) and contract re-validation (H6c) together', async () => {
  const cwd = project();
  const run = await twoTaskHostRun(cwd);

  const { nextTask } = await submitHostTaskResult(cwd, run.runId, 't1', { output: 'PM-RESULT: release plan drafted with tradeoffs.' }, { env: ENV });
  assert.equal(nextTask.id, 't2');
  assert.match(nextTask.hostPrompt.user, /## Prior Worker Profile results/, 'H6a: the re-materialized next prompt carries the upstream result');
  assert.ok(nextTask.hostPrompt.user.includes('PM-RESULT: release plan drafted with tradeoffs.'));

  const { run: finalRun } = await submitHostTaskResult(cwd, run.runId, 't2', { output: 'Ran the tests; all passed.' }, { env: ENV });
  assert.equal(finalRun.status, 'completed');
  assert.ok(finalRun.tasks.every((t) => t.status === 'done'));
});
