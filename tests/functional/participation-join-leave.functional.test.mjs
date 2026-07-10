/**
 * tests/functional/participation-join-leave.functional.test.mjs —
 * evolving-signal join/leave over a live run (construct-pteo2.11).
 *
 * A provider task's real output is a signal source: a cost table appearing in
 * the first specialist's output recruits the cost reviewers onto the SAME run
 * (join), executed by the remaining loop iterations; a joined participant the
 * run cancels before reaching leaves with a recorded reason (leave). Both are
 * pinned in the durable run record (run.participation), the run events, and
 * the trace file. Deterministic fetch, zero network.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { planRun, executeRun } from '../../lib/orchestration/runtime.mjs';
import { loadRun } from '../../lib/orchestration/run-store.mjs';
import { requestCancel, onRunEvent } from '../../lib/orchestration/events.mjs';
import { readTraceEventsForRun } from '../../lib/worker/trace.mjs';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const MODEL = 'anthropic/claude-sonnet-4-6';
const ENV = { CX_MODEL_REASONING: MODEL, CX_MODEL_STANDARD: MODEL, CX_MODEL_FAST: MODEL, ANTHROPIC_API_KEY: 'sk-test' };

const COST_OUTPUT = [
  'Design review of the gateway rate limiter.',
  '',
  '| Item | Amount |',
  '|---|---|',
  '| Redis cluster | $2M |',
].join('\n');

const dirs = [];
function project() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-join-leave-'));
  dirs.push(cwd);
  return cwd;
}

const homeOverride = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-join-leave-home-'));
const prevHomeOverride = process.env.CX_HOME_OVERRIDE;
process.env.CX_HOME_OVERRIDE = homeOverride;
test.after(() => {
  for (const d of dirs) { try { rmTmpDir(d); } catch {} }
  try { rmTmpDir(homeOverride); } catch {}
  if (prevHomeOverride === undefined) delete process.env.CX_HOME_OVERRIDE;
  else process.env.CX_HOME_OVERRIDE = prevHomeOverride;
});

function costFirstFetch() {
  let calls = 0;
  return async () => {
    calls += 1;
    const text = calls === 1 ? COST_OUTPUT : 'plain specialist output with no financial content';
    return { ok: true, json: async () => ({ content: [{ type: 'text', text }] }) };
  };
}

test('a cost table in mid-run output joins the cost reviewer, who then executes', async () => {
  const cwd = project();
  const planned = await planRun(
    { request: 'implement rate limiting for the api gateway and review for security', requestedStrategy: 'orchestrated', hostModel: MODEL },
    { env: ENV, cwd },
  );

  const events = [];
  const off = onRunEvent(planned.runId, (e) => { if (e.type === 'participant') events.push(e); });
  const run = await executeRun(cwd, planned.runId, { env: ENV, workerBackend: 'provider', fetchImpl: costFirstFetch() });
  off?.();

  const joined = (run.participation ?? []).filter((p) => p.event === 'joined');
  const analystJoin = joined.find((p) => p.role === 'cx-data-analyst');
  assert.ok(analystJoin, `cost output joins cx-data-analyst; participation: ${JSON.stringify(run.participation)}`);
  assert.ok(analystJoin.reason, 'the join carries a reason');
  assert.equal(analystJoin.afterTask, run.tasks[0].id, 'joined after the task whose output fired the signal');

  const analystTask = run.tasks.find((t) => t.role === 'cx-data-analyst');
  assert.ok(analystTask, 'a task exists for the joined participant');
  assert.equal(analystTask.joinedVia, 'evolving-signals');
  assert.equal(analystTask.status, 'done', 'the joined participant executed in the same run');
  assert.equal(analystTask.executionState, 'executed');

  assert.ok(events.some((e) => e.event === 'joined' && e.role === 'cx-data-analyst'), 'join emitted as a run event');

  const traceEvents = readTraceEventsForRun(cwd, planned.runId);
  assert.ok(
    traceEvents.some((e) => e.eventType === 'participant.joined' && e.role === 'cx-data-analyst'),
    `join recorded in the trace; events: ${traceEvents.map((e) => e.eventType).join(',')}`,
  );

  const persisted = loadRun(cwd, planned.runId);
  assert.ok(persisted.participation.some((p) => p.event === 'joined' && p.role === 'cx-data-analyst'), 'join durable in the run record');
});

test('a joined participant the run cancels before reaching leaves with a recorded reason', async () => {
  const cwd = project();
  const planned = await planRun(
    { request: 'implement rate limiting for the api gateway and review for security', requestedStrategy: 'orchestrated', hostModel: MODEL },
    { env: ENV, cwd },
  );

  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    if (calls === 2) requestCancel(planned.runId);
    const text = calls === 1 ? COST_OUTPUT : 'plain output';
    return { ok: true, json: async () => ({ content: [{ type: 'text', text }] }) };
  };

  const run = await executeRun(cwd, planned.runId, { env: ENV, workerBackend: 'provider', fetchImpl });

  assert.equal(run.status, 'cancelled');
  const joined = run.participation.find((p) => p.event === 'joined' && p.role === 'cx-data-analyst');
  assert.ok(joined, 'the cost reviewer joined before the cancel');

  const left = run.participation.find((p) => p.event === 'left' && p.role === 'cx-data-analyst');
  assert.ok(left, `the never-executed join leaves; participation: ${JSON.stringify(run.participation)}`);
  assert.match(left.reason, /cancelled/);

  const analystTask = run.tasks.find((t) => t.role === 'cx-data-analyst');
  assert.equal(analystTask.status, 'withdrawn', 'the joined task is withdrawn, not silently dropped');

  const traceEvents = readTraceEventsForRun(cwd, planned.runId);
  assert.ok(traceEvents.some((e) => e.eventType === 'participant.left' && e.role === 'cx-data-analyst'), 'leave recorded in the trace');
});

test('a run with no emergent signals records no participation churn', async () => {
  const cwd = project();
  const planned = await planRun(
    { request: 'implement rate limiting for the api gateway and review for security', requestedStrategy: 'orchestrated', hostModel: MODEL },
    { env: ENV, cwd },
  );
  const fetchImpl = async () => ({ ok: true, json: async () => ({ content: [{ type: 'text', text: 'plain output, nothing emergent' }] }) });
  const run = await executeRun(cwd, planned.runId, { env: ENV, workerBackend: 'provider', fetchImpl });

  assert.deepEqual(run.participation, [], 'empty ledger, no fabricated churn');
  assert.equal(run.tasks.every((t) => t.joinedVia === undefined), true);
});
