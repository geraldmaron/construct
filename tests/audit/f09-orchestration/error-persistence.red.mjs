/**
 * tests/audit/f09-orchestration/error-persistence.red.mjs — F09 [R18] lost-failure proof.
 *
 * RED fixtures (must FAIL against current code). startRun (lib/orchestration/runtime.mjs
 * L334-342) plans a run synchronously, then runs executeRun in the BACKGROUND
 * (not awaited). If executeRun rejects — e.g. the run store cannot persist a
 * transition — the only record is an ephemeral, process-local run EVENT
 * (emitRunEvent type='error', events.mjs); the catch never writes a terminal status to
 * the run store. The persisted run is therefore frozen at status='planned', and
 * getRun/getRuns (the queryable surface doctor and `orchestration_status` read) never
 * see the failure. A terminal orchestration failure is silently lost.
 *
 * Per-task provider failures ARE persisted (executeTaskViaProvider records
 * task.status='failed' and the run completes 'completed-with-failures'); this fixture
 * targets the narrower, real hole: a failure thrown OUT of executeRun itself.
 *
 * Deterministic, hermetic trigger: after planRun persists the run, the runs directory is
 * made read-only, so executeRun's first store write (status='running') throws EACCES.
 * No network and no provider are involved. The directory is restored before assertions
 * so getRun/getRuns can read the (still 'planned') record, and removed in teardown.
 *
 * Contract these encode (CX-AUDIT-ORCH-002): a terminal background failure must be
 * PERSISTED to the run store with a failed/error status (and a recorded error), so it is
 * queryable by status/doctor — not merely emitted to an in-process event bus and lost.
 *
 * Each fixture passes once startRun's failure path durably records the terminal error.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { planRun, executeRun, startRun, getRun, getRuns } from '../../../lib/orchestration/runtime.mjs';
import { onRunEvent } from '../../../lib/orchestration/events.mjs';

const MODEL = 'anthropic/claude-sonnet-4-6';
const ENV = { CX_MODEL_REASONING: MODEL, CX_MODEL_STANDARD: MODEL, CX_MODEL_FAST: MODEL };

const dirs = [];
const chmodded = [];
function project() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-f09-persist-'));
  dirs.push(cwd);
  return cwd;
}
test.after(() => {
  for (const d of chmodded) { try { fs.chmodSync(d, 0o755); } catch {} }
  for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} }
});

function runsDirOf(cwd) {
  return path.join(cwd, '.cx', 'runtime', 'orchestration', 'runs');
}

const REQUEST = { request: 'a run whose execution will fail to persist', requestedStrategy: 'orchestrated', hostModel: MODEL, fileCount: 2 };

const FAILED_STATES = new Set(['failed', 'error', 'completed-with-failures']);

test('[R18] a terminal executeRun failure is PERSISTED to the run store, not just emitted', async () => {
  const cwd = project();
  const planned = await planRun(REQUEST, { env: ENV, cwd });

  const runsDir = runsDirOf(cwd);
  fs.chmodSync(runsDir, 0o555);
  chmodded.push(runsDir);

  let threw = null;
  try {
    await executeRun(cwd, planned.runId, { env: ENV });
  } catch (err) {
    threw = err;
  }
  fs.chmodSync(runsDir, 0o755);

  assert.ok(threw, 'precondition: executeRun threw when the store could not persist a transition');

  const persisted = await getRun(cwd, planned.runId);
  assert.ok(persisted, 'precondition: the planned run record still exists');
  assert.ok(
    FAILED_STATES.has(persisted.status),
    `executeRun threw but the persisted run is status='${persisted.status}' (still terminal-less); `
      + `a terminal failure must be durably recorded as failed/error so status/doctor can see it. `
      + `error=${threw && (threw.code || threw.message)}`,
  );
});

test('[R18] a background startRun failure becomes queryable via getRuns (doctor/status surface)', async () => {
  const cwd = project();

  const planned = await startRun(REQUEST, { env: ENV, cwd });

  const runsDir = runsDirOf(cwd);
  fs.chmodSync(runsDir, 0o555);
  chmodded.push(runsDir);

  let errorEvent = null;
  const off = onRunEvent(planned.runId, (e) => { if (e.status === 'error' || e.type === 'error') errorEvent = e; });
  await new Promise((r) => setTimeout(r, 200));
  off();
  fs.chmodSync(runsDir, 0o755);

  const listed = await getRuns(cwd, { env: ENV });
  const entry = listed.find((r) => r.runId === planned.runId);
  assert.ok(entry, `precondition: the run appears in the queryable list. listed=${JSON.stringify(listed)}`);
  assert.ok(
    FAILED_STATES.has(entry.status),
    `the background run failed (errorEventEmitted=${!!errorEvent}) but getRuns reports status='${entry.status}'. `
      + `A failure recorded only on the in-process event bus is invisible to doctor/status; it must be persisted. `
      + `entry=${JSON.stringify(entry)}`,
  );
});
