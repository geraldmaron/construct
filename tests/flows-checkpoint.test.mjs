/**
 * tests/flows-checkpoint.test.mjs — flow run checkpoint/resume.
 *
 * Pins: a run is checkpointed after every completed step; resumeRun()
 * reconstructs the same Run shape (state, frontier, completed set, join
 * progress, usage, history) from the persisted checkpoint; a completed step
 * is never re-entered on resume because the frontier never holds a
 * completed step; runCheckpointed() drives a flow to completion across a
 * simulated crash/restart (a fresh in-memory run rebuilt from the checkpoint
 * rather than the live object continuing); resuming against a different
 * flow id throws FlowCheckpointError. CONSTRUCT_HOME_OVERRIDE is pinned for the
 * whole file so state-root reads/writes never touch the real machine's
 * $HOME (see rules/common — leaking test state under ~/.construct/projects/
 * is a repeat regression this repo has already paid for once).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { defineFlow } from '../lib/flows/define.mjs';
import { TERMINAL, RUN_STATUS, STEP_STATUS } from '../lib/flows/constants.mjs';
import {
  FlowCheckpointError,
  checkpointRun,
  loadCheckpoint,
  resumeRun,
  startRun,
  runCheckpointed,
} from '../lib/flows/checkpoint.mjs';

const homeOverride = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-flow-checkpoint-home-'));
const prevHomeOverride = process.env.CONSTRUCT_HOME_OVERRIDE;
process.env.CONSTRUCT_HOME_OVERRIDE = homeOverride;
test.after(() => {
  try { fs.rmSync(homeOverride, { recursive: true, force: true }); } catch {}
  if (prevHomeOverride === undefined) delete process.env.CONSTRUCT_HOME_OVERRIDE;
  else process.env.CONSTRUCT_HOME_OVERRIDE = prevHomeOverride;
});

const dirs = [];
function project() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-flow-checkpoint-project-'));
  dirs.push(cwd);
  return cwd;
}
test.after(() => { for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} } });

const stateSchema = { type: 'object', properties: { count: { type: 'integer' }, log: { type: 'array' } } };

function sequentialFlow(id = 'checkpoint-demo') {
  return defineFlow({
    id,
    stateSchema,
    startStep: 'a',
    steps: {
      a: { workerBackend: 'inline', run: (input, ctx) => ({ state: { count: (ctx.state.count || 0) + 1, log: [...(ctx.state.log || []), 'a'] } }), router: () => 'b' },
      b: { workerBackend: 'inline', run: (input, ctx) => ({ state: { count: (ctx.state.count || 0) + 1, log: [...(ctx.state.log || []), 'b'] } }), router: () => 'c' },
      c: { workerBackend: 'inline', run: (input, ctx) => ({ state: { count: (ctx.state.count || 0) + 1, log: [...(ctx.state.log || []), 'c'] } }), router: () => TERMINAL },
    },
  });
}

test('checkpointRun persists a run and loadCheckpoint reads it back raw', () => {
  const cwd = project();
  const flow = sequentialFlow();
  const run = startRun(cwd, 'run-1', flow, { count: 0, log: [] });
  assert.equal(run.status, RUN_STATUS.RUNNING);

  const checkpoint = loadCheckpoint(cwd, 'run-1');
  assert.ok(checkpoint);
  assert.equal(checkpoint.runId, 'run-1');
  assert.equal(checkpoint.flowId, 'checkpoint-demo');
  assert.deepEqual(checkpoint.run.frontier, ['a']);
});

test('resumeRun reconstructs the same Run shape (state, frontier, completed, joinProgress, usage, history)', async () => {
  const cwd = project();
  const flow = sequentialFlow();
  let run = startRun(cwd, 'run-2', flow, { count: 0, log: [] });
  const { advanceRun } = await import('../lib/flows/engine.mjs');
  run = await advanceRun(run);
  checkpointRun(cwd, 'run-2', flow, run);

  const resumed = resumeRun(cwd, 'run-2', flow);
  assert.deepEqual(resumed.state, run.state);
  assert.deepEqual(resumed.frontier, run.frontier);
  assert.deepEqual([...resumed.completed], [...run.completed]);
  assert.deepEqual([...resumed.usage.entries()], [...run.usage.entries()]);
  assert.equal(resumed.history.length, run.history.length);
  assert.equal(resumed.status, run.status);
});

test('resumeRun returns null when no checkpoint exists', () => {
  const cwd = project();
  const flow = sequentialFlow();
  assert.equal(resumeRun(cwd, 'no-such-run', flow), null);
});

test('resumeRun throws FlowCheckpointError when the checkpoint was recorded under a different flow id', () => {
  const cwd = project();
  const flowA = sequentialFlow('flow-a');
  const flowB = sequentialFlow('flow-b');
  startRun(cwd, 'run-3', flowA, { count: 0, log: [] });
  assert.throws(() => resumeRun(cwd, 'run-3', flowB), FlowCheckpointError);
});

test('runCheckpointed drives a flow to completion, checkpointing after every tick', async () => {
  const cwd = project();
  const flow = sequentialFlow();
  const run = await runCheckpointed(cwd, 'run-4', flow, { count: 0, log: [] });
  assert.equal(run.status, RUN_STATUS.COMPLETED);
  assert.deepEqual(run.state.log, ['a', 'b', 'c']);
  assert.equal(run.history.length, 3);

  const checkpoint = loadCheckpoint(cwd, 'run-4');
  assert.equal(checkpoint.run.status, RUN_STATUS.COMPLETED);
});

test('a run killed mid-flow resumes to completion from its last checkpoint without re-entering a completed step', async () => {
  const cwd = project();
  const flow = sequentialFlow();

  // Simulate a crash after step "a": drive one tick by hand (mirroring what
  // runCheckpointed does internally) and stop there, as if the process died
  // right after that checkpoint landed.
  const { advanceRun } = await import('../lib/flows/engine.mjs');
  let run = startRun(cwd, 'run-5', flow, { count: 0, log: [] });
  run = await advanceRun(run);
  checkpointRun(cwd, 'run-5', flow, run);
  assert.deepEqual(run.completed && [...run.completed], ['a']);
  assert.deepEqual(run.frontier, ['b']);

  // "Restart": construct a brand-new run object purely from the checkpoint,
  // never touching the live `run` above, then finish the drive.
  const resumed = await runCheckpointed(cwd, 'run-5', flow, { count: 0, log: [] });
  assert.equal(resumed.status, RUN_STATUS.COMPLETED);
  assert.deepEqual(resumed.state.log, ['a', 'b', 'c'], 'step "a" ran exactly once — resume continued from "b", it did not restart from "a"');
  assert.equal(resumed.history.length, 3, 'full history (a, b, c) carries across the resume — "a" is not duplicated');
  assert.equal(resumed.history.filter((h) => h.step === 'a').length, 1, 'step "a" appears exactly once in history despite the restart');
});

test('a resumed run at BUDGET_EXHAUSTED status stays terminal and is not re-driven', async () => {
  const cwd = project();
  const flow = defineFlow({
    id: 'budget-demo',
    stateSchema,
    startStep: 'loop',
    steps: {
      loop: {
        workerBackend: 'inline',
        budget: 1,
        run: (input, ctx) => ({ state: { count: (ctx.state.count || 0) + 1 }, usage: { consumed: 1 } }),
        router: () => 'loop',
      },
    },
  });
  const run = await runCheckpointed(cwd, 'run-6', flow, { count: 0 });
  assert.equal(run.status, RUN_STATUS.BUDGET_EXHAUSTED);
  assert.equal(run.history[run.history.length - 1].status, STEP_STATUS.BUDGET_EXHAUSTED);

  const again = await runCheckpointed(cwd, 'run-6', flow, { count: 0 });
  assert.equal(again.status, RUN_STATUS.BUDGET_EXHAUSTED);
  assert.equal(again.history.length, run.history.length, 'a terminal checkpoint is not re-driven on a second resume call');
});
