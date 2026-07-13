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
const ENV = { CX_MODEL_REASONING: MODEL, CX_MODEL_STANDARD: MODEL, CX_MODEL_FAST: MODEL };

const dirs = [];
function project() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-host-contract-'));
  dirs.push(cwd);
  return cwd;
}
test.after(() => { for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} } });

const homeOverride = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-host-contract-home-'));
const prevHomeOverride = process.env.CX_HOME_OVERRIDE;
process.env.CX_HOME_OVERRIDE = homeOverride;
test.after(() => {
  try { fs.rmSync(homeOverride, { recursive: true, force: true }); } catch {}
  if (prevHomeOverride === undefined) delete process.env.CX_HOME_OVERRIDE;
  else process.env.CX_HOME_OVERRIDE = prevHomeOverride;
});

function readViolations(cwd) {
  const file = violationLogPath(cwd);
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

// engineer-to-qa is the one contract lib/orchestration/worker.mjs's
// adjacent-task disambiguation resolves unambiguously for cx-engineer ->
// cx-qa (proven in tests/contracts-worker-boundary.test.mjs's own
// end-to-end case for the provider path) — reused here so both boundaries
// are proven against the identical, real, unambiguous pair.

async function twoTaskHostRun(cwd) {
  const planned = await planRun(
    { request: 'implement and verify a rate limiter', requestedStrategy: 'orchestrated', hostModel: MODEL, host: 'OpenCode', fileCount: 4, moduleCount: 2 },
    { env: ENV, cwd },
  );
  planned.tasks = ['cx-engineer', 'cx-qa'].map((role, seq) => ({
    id: `t${seq + 1}`, seq, role, reason: null, handoffContract: null,
    status: 'queued', executor: null, output: null, reasoning: null, error: null, startedAt: null, finishedAt: null,
  }));
  const { store } = resolveRunStore({ config: {}, env: ENV, cwd });
  await store.saveRun(planned);
  return executeRun(cwd, planned.runId, { env: ENV, workerBackend: 'host' });
}

test('a host-reported result with contract-failing free text is recorded ok+warned, never blocked-contract or degraded', async () => {
  const cwd = project();
  const run = await twoTaskHostRun(cwd);

  const { run: afterFirst } = await submitHostTaskResult(cwd, run.runId, 't1', { output: 'Implemented a token-bucket rate limiter.' }, { env: ENV });
  const engineerTask = afterFirst.tasks.find((t) => t.id === 't1');

  assert.equal(engineerTask.contractId, 'engineer-to-qa', 'the adjacent dispatched task (cx-qa) disambiguates the ambiguous cx-engineer outgoing set');
  assert.equal(engineerTask.contractStatus, 'ok', 'warn mode never reports blocked-contract for an auto-populated packet');
  assert.ok(Array.isArray(engineerTask.contractViolations) && engineerTask.contractViolations.length > 0, 'the real violation still rides the task, not silently dropped');
  assert.notEqual(afterFirst.status, 'degraded', 'a warn-mode contract violation must never degrade the run');

  const violations = readViolations(cwd);
  assert.equal(violations.length, 1);
  assert.equal(violations[0].contractId, 'engineer-to-qa');
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
  run.tasks.find((t) => t.id === 't1').outputPacket = { verdict: 'LGTM' };
  const { store } = resolveRunStore({ config: {}, env: ENV, cwd });
  await store.saveRun(run);

  const { run: afterFirst } = await submitHostTaskResult(cwd, run.runId, 't1', { output: 'engineer output' }, { env: ENV });
  const updated = afterFirst.tasks.find((t) => t.id === 't1');
  assert.deepEqual(updated.outputPacket, { verdict: 'LGTM' }, 'the caller-supplied packet is never overwritten with the submitted free text');
  assert.equal(updated.contractStatus, 'blocked-contract', 'block enforcement genuinely fires for a caller-supplied packet, unlike the auto-populated warn-mode case above');
});

test('the run completes cleanly through both boundaries: host re-materialization (H6a) and contract re-validation (H6c) together', async () => {
  const cwd = project();
  const run = await twoTaskHostRun(cwd);

  const { nextTask } = await submitHostTaskResult(cwd, run.runId, 't1', { output: 'ENGINEER-RESULT: rate limiter implemented.' }, { env: ENV });
  assert.equal(nextTask.id, 't2');
  assert.match(nextTask.hostPrompt.user, /## Prior specialist results/, 'H6a: the re-materialized next prompt carries the upstream result');
  assert.ok(nextTask.hostPrompt.user.includes('ENGINEER-RESULT: rate limiter implemented.'));

  const { run: finalRun } = await submitHostTaskResult(cwd, run.runId, 't2', { output: 'Ran the tests; all passed.' }, { env: ENV });
  assert.equal(finalRun.status, 'completed');
  assert.ok(finalRun.tasks.every((t) => t.status === 'done'));
});
