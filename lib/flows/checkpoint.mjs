/**
 * lib/flows/checkpoint.mjs — durable per-step checkpointing and resume for flow runs.
 *
 * Persists a Run after every completed step under the project's machine-scoped
 * state root at `runtime/flows/runs/<runId>.json`, atomic write via
 * temp-file-then-rename — the same pattern lib/orchestration/run-store.mjs uses
 * for orchestration runs. A run's Set/Map fields (completed, joinProgress,
 * usage) are serialized to plain arrays and reconstructed on load; the flow
 * definition itself (its run/router functions) is never persisted — a
 * resuming caller supplies the same flow object it would use to start a run,
 * exactly like loadFlow's `handlers` pattern for JSON flows. A checkpoint
 * records which flow id it was written under; resuming against a different
 * flow id throws rather than silently replaying history against the wrong
 * step graph.
 *
 * Idempotent re-entry: runCheckpointed() checkpoints strictly AFTER each
 * advanceRun() call, so a step already reflected in a saved checkpoint's
 * `completed` set is never in that checkpoint's `frontier` and will not
 * re-run on resume — the frontier only ever holds not-yet-completed steps,
 * which is a property of the Run shape itself, not something this module adds.
 * The remaining window — a crash between a step's run() executing and the
 * following checkpoint write landing — is closed by authoring convention, not
 * an engine guarantee: a step's run() must be idempotent under at-least-once
 * execution (pure computation, or a naturally idempotent side effect such as
 * an upsert), the same constraint the engine already implies by recording
 * delegation intent rather than performing it (engine.mjs's workerBackend
 * handling). A step that must perform an exactly-once side effect belongs
 * outside the engine, driven by its recorded delegation, not inside run().
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { resolveStateDir } from '../state-root.mjs';
import { createRun, advanceRun } from './engine.mjs';
import { RUN_STATUS } from './constants.mjs';

export class FlowCheckpointError extends Error {
  constructor(message) {
    super(message);
    this.name = 'FlowCheckpointError';
    this.code = 'FLOW_CHECKPOINT_MISMATCH';
  }
}

let writeCounter = 0;

export function runsDir(cwd = process.cwd()) {
  return resolveStateDir(cwd, 'runtime', 'flows', 'runs', { ensureDir: false });
}

function checkpointPath(cwd, runId) {
  return join(runsDir(cwd), `${runId}.json`);
}

function atomicWriteJson(filePath, value) {
  writeCounter = (writeCounter + 1) % 100000;
  const tmp = `${filePath}.${process.pid}.${writeCounter}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(tmp, filePath);
}

function serializeRun(run) {
  return {
    state: run.state,
    frontier: [...run.frontier],
    completed: [...run.completed],
    joinProgress: [...run.joinProgress.entries()].map(([step, satisfied]) => [step, [...satisfied]]),
    usage: [...run.usage.entries()],
    history: run.history,
    status: run.status,
    error: run.error,
  };
}

function deserializeRun(flow, data) {
  return {
    flow,
    state: data.state,
    frontier: [...(data.frontier || [])],
    completed: new Set(data.completed || []),
    joinProgress: new Map((data.joinProgress || []).map(([step, satisfied]) => [step, new Set(satisfied)])),
    usage: new Map(data.usage || []),
    history: data.history || [],
    status: data.status,
    error: data.error || null,
  };
}

/**
 * Persist a run's current state to its checkpoint file. Overwrites any prior
 * checkpoint for the same runId — a checkpoint is the run's latest snapshot,
 * not a history of every tick (history already lives on the run itself).
 */
export function checkpointRun(cwd, runId, flow, run) {
  const dir = runsDir(cwd);
  mkdirSync(dir, { recursive: true });
  atomicWriteJson(checkpointPath(cwd, runId), {
    runId,
    flowId: flow.id ?? null,
    updatedAt: new Date().toISOString(),
    run: serializeRun(run),
  });
}

/**
 * Read a checkpoint's raw persisted shape ({runId, flowId, updatedAt, run}),
 * or null when no checkpoint exists or the file is corrupt.
 */
export function loadCheckpoint(cwd, runId) {
  const file = checkpointPath(cwd, runId);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Reconstruct a Run from its checkpoint against the given flow, or null when
 * no checkpoint exists. Throws FlowCheckpointError when the checkpoint was
 * recorded against a different flow id than the one supplied — resuming a
 * run against the wrong step graph would silently reinterpret its history.
 */
export function resumeRun(cwd, runId, flow) {
  const checkpoint = loadCheckpoint(cwd, runId);
  if (!checkpoint) return null;
  if (flow.id && checkpoint.flowId && flow.id !== checkpoint.flowId) {
    throw new FlowCheckpointError(`checkpoint "${runId}" was recorded against flow "${checkpoint.flowId}", not "${flow.id}"`);
  }
  return deserializeRun(flow, checkpoint.run);
}

/**
 * Start a new run and checkpoint it immediately, so a resume attempted before
 * the first tick still finds a valid checkpoint rather than nothing.
 */
export function startRun(cwd, runId, flow, initialState = {}) {
  const run = createRun(flow, initialState);
  checkpointRun(cwd, runId, flow, run);
  return run;
}

/**
 * Advance a checkpointed run by exactly one tick: resume from the last
 * checkpoint when one exists, otherwise start fresh from initialState, then
 * run a single advanceRun() and checkpoint the result. Unlike
 * runCheckpointed(), this never loops to completion — each call surfaces
 * exactly the step that tick just completed, which is what a caller driving
 * a run one step at a time needs: the current step, not the whole remaining
 * chain. A run already at a terminal status is returned as-is, not re-driven.
 */
export async function tickCheckpointed(cwd, runId, flow, initialState = {}) {
  let run = resumeRun(cwd, runId, flow) ?? startRun(cwd, runId, flow, initialState);
  if (run.status === RUN_STATUS.RUNNING) {
    run = await advanceRun(run);
    checkpointRun(cwd, runId, flow, run);
  }
  return run;
}

/**
 * Drive a flow to completion one checkpointed tick at a time: resume from the
 * last checkpoint when one exists, otherwise start fresh from initialState.
 * Every tick's result is checkpointed before the loop continues, so a crash
 * at any point resumes from the most recently completed step, never earlier
 * and never mid-step.
 */
export async function runCheckpointed(cwd, runId, flow, initialState = {}, { maxSteps = 10000 } = {}) {
  let run = resumeRun(cwd, runId, flow) ?? startRun(cwd, runId, flow, initialState);
  let steps = 0;
  while (run.status === RUN_STATUS.RUNNING && steps < maxSteps) {
    run = await advanceRun(run);
    checkpointRun(cwd, runId, flow, run);
    steps += 1;
  }
  if (run.status === RUN_STATUS.RUNNING && steps >= maxSteps) {
    run = { ...run, status: RUN_STATUS.ERROR, error: { code: 'MAX_STEPS_EXCEEDED', message: `flow exceeded ${maxSteps} steps without reaching a terminal state` } };
    checkpointRun(cwd, runId, flow, run);
  }
  return run;
}
