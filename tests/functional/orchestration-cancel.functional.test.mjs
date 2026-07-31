/**
 * tests/functional/orchestration-cancel.functional.test.mjs.
 *
 * Before this, cancellation was a module-level in-memory Set — it never survived a restart
 * or crossed processes, so a cancel requested by an MCP host or the CLI could not reach the
 * process actually executing the run. These pin the persisted path: cancelOrchestrationRun
 * writes the flag onto the run in the store, and executeRun's between-task check reads the
 * store (not just the in-memory Set), so a cancel written by another process stops the run
 * cleanly. Unknown and already-terminal runs are refused; the MCP handler wraps it.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { planRun, executeRun, cancelOrchestrationRun } from '../../lib/orchestration/runtime.mjs';
import { orchestrationCancel } from '../../lib/mcp/tools/orchestration-run.mjs';
import { resolveRunStore } from '../../lib/orchestration/store.mjs';

const MODEL = 'anthropic/claude-sonnet-4-6';
const ENV = { CONSTRUCT_MODEL_REASONING: MODEL, CONSTRUCT_MODEL_STANDARD: MODEL, CONSTRUCT_MODEL_FAST: MODEL };

const dirs = [];
function project() { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-cancel-')); dirs.push(d); return d; }
test.after(() => { for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} } });

const homeOverride = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-cancel-home-'));
const prevHomeOverride = process.env.CONSTRUCT_HOME_OVERRIDE;
process.env.CONSTRUCT_HOME_OVERRIDE = homeOverride;
test.after(() => {
  try { fs.rmSync(homeOverride, { recursive: true, force: true }); } catch {}
  if (prevHomeOverride === undefined) delete process.env.CONSTRUCT_HOME_OVERRIDE;
  else process.env.CONSTRUCT_HOME_OVERRIDE = prevHomeOverride;
});

async function plannedRun(cwd) {
  const planned = await planRun(
    { request: 'implement and verify a pagination feature', requestedStrategy: 'orchestrated', hostModel: MODEL, fileCount: 4, moduleCount: 2 },
    { env: ENV, cwd },
  );
  const { store } = resolveRunStore({ config: {}, env: ENV, cwd });
  await store.saveRun(planned);
  return { planned, store };
}

test('cancelOrchestrationRun persists the cancel flag onto the run', async () => {
  const cwd = project();
  const { planned, store } = await plannedRun(cwd);
  const result = await cancelOrchestrationRun(planned.runId, { env: ENV, cwd });
  assert.equal(result.ok, true);
  assert.equal(result.runId, planned.runId);
  const reloaded = await store.loadRun(planned.runId);
  assert.equal(reloaded.cancelRequested, true, 'the flag persists in the store');
  assert.ok(reloaded.cancelRequestedAt, 'a timestamp is recorded');
});

test('a persisted cancel written by another process stops executeRun cleanly (cross-process path)', async () => {
  const cwd = project();
  const { planned, store } = await plannedRun(cwd);
  // Simulate a cancel written by a different process: set the persisted flag directly,
  // WITHOUT touching the in-memory Set, so only the store read can catch it.
  planned.cancelRequested = true;
  planned.cancelRequestedAt = new Date().toISOString();
  await store.saveRun(planned);

  const run = await executeRun(cwd, planned.runId, { env: ENV, workerBackend: 'inline' });
  assert.equal(run.status, 'cancelled', 'executeRun observes the persisted flag and finalizes cancelled');
  assert.ok(run.tasks.every((t) => t.status !== 'done'), 'no task executed after the persisted cancel');
});

test('cancelling an unknown or already-terminal run is refused', async () => {
  const cwd = project();
  const unknown = await cancelOrchestrationRun('cert-nonexistent-run', { env: ENV, cwd });
  assert.equal(unknown.ok, false);
  assert.equal(unknown.reason, 'run-not-found');

  const { planned, store } = await plannedRun(cwd);
  planned.status = 'completed';
  await store.saveRun(planned);
  const terminal = await cancelOrchestrationRun(planned.runId, { env: ENV, cwd });
  assert.equal(terminal.ok, false);
  assert.equal(terminal.reason, 'already-terminal');
  assert.equal(terminal.previousStatus, 'completed');
});

test('the orchestration_cancel MCP handler wraps cancelOrchestrationRun', async () => {
  const cwd = project();
  const { planned } = await plannedRun(cwd);
  const ok = await orchestrationCancel({ run_id: planned.runId }, { env: ENV, cwd });
  assert.equal(ok.cancelled, true);
  assert.equal(ok.runId, planned.runId);
  assert.match(ok.note, /soft cancel/i);

  const missing = await orchestrationCancel({}, { env: ENV, cwd });
  assert.ok(missing.error, 'run_id is required');
});
