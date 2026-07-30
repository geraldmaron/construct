/**
 * tests/functional/flow-checkpoint-resume.functional.test.mjs — flow-engine
 * checkpoint/resume survives a simulated crash.
 *
 * Multi-component (engine + durable state + CLI), per the functional-test
 * gate for a CLI subcommand that reads/writes durable state. Drives one tick of
 * a real flow in-process, checkpoints it, then simulates a crash/restart by
 * spawning the real `construct flow resume` binary as a fresh process — a
 * fresh in-memory Run rebuilt from the checkpoint, never the live object
 * continuing — and asserts the run reaches completion with each step's side
 * effect (an append to a marker file) applied exactly once, proving the
 * already-checkpointed step was not re-entered on resume.
 *
 * @capability flows.checkpoint
 */

import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import { startRun, checkpointRun, loadCheckpoint } from '../../lib/flows/checkpoint.mjs';
import { advanceRun } from '../../lib/flows/engine.mjs';
import { defineFlow } from '../../lib/flows/define.mjs';
import { sterileSpawnEnv } from '../helpers/sterile-env.mjs';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = join(REPO_ROOT, 'bin', 'construct');

function sandbox() {
  const root = mkdtempSync(join(tmpdir(), 'flow-checkpoint-resume-'));
  const HOME = join(root, 'HOME');
  const project = join(root, 'project');
  mkdirSync(HOME, { recursive: true });
  mkdirSync(project, { recursive: true });
  return { root, HOME, project, cleanup() { rmTmpDir(root); } };
}

// A three-step flow whose each step appends its own name to a JSON-lines
// marker file on disk — an observable side effect distinct from the Run's own
// state, so "did step A run twice" is provable independent of the engine's
// own bookkeeping.

function writeFlowModule(project, markerPath) {
  const flowPath = join(project, 'crash-demo-flow.mjs');
  writeFileSync(flowPath, `
    import fs from 'node:fs';
    function markStep(name) {
      fs.appendFileSync(${JSON.stringify(markerPath)}, name + '\\n');
    }
    export default {
      id: 'crash-demo',
      stateSchema: { type: 'object', properties: { count: { type: 'integer' } } },
      startStep: 'a',
      steps: {
        a: { workerBackend: 'inline', run: (input, ctx) => { markStep('a'); return { state: { count: (ctx.state.count || 0) + 1 } }; }, router: () => 'b' },
        b: { workerBackend: 'inline', run: (input, ctx) => { markStep('b'); return { state: { count: (ctx.state.count || 0) + 1 } }; }, router: () => 'c' },
        c: { workerBackend: 'inline', run: (input, ctx) => { markStep('c'); return { state: { count: (ctx.state.count || 0) + 1 } }; }, router: () => '@@flow/terminal' },
      },
    };
  `);
  return flowPath;
}

function readMarkers(markerPath) {
  if (!existsSync(markerPath)) return [];
  return readFileSync(markerPath, 'utf8').trim().split('\n').filter(Boolean);
}

// loadCheckpoint resolves the machine-scoped state root via
// CONSTRUCT_HOME_OVERRIDE on process.env directly; this process must pin the same
// override the spawned CLI saw, or it reads the real developer machine's
// state root instead (mirrors getRunInSandbox in
// tests/functional/host-execution-pickup.functional.test.mjs).

function loadCheckpointInSandbox(env, runId) {
  const prev = process.env.CONSTRUCT_HOME_OVERRIDE;
  process.env.CONSTRUCT_HOME_OVERRIDE = env.HOME;
  try {
    return loadCheckpoint(env.project, runId);
  } finally {
    if (prev === undefined) delete process.env.CONSTRUCT_HOME_OVERRIDE;
    else process.env.CONSTRUCT_HOME_OVERRIDE = prev;
  }
}

test('a flow killed mid-run resumes via the real CLI to completion without re-entering the already-checkpointed step', async (t) => {
  const env = sandbox();
  t.after(() => env.cleanup());

  const markerPath = join(env.project, 'steps.log');
  const flowPath = writeFlowModule(env.project, markerPath);

  // Simulate the process that ran step "a" and checkpointed it, then died —
  // driven in-process here, exactly as the Run shape is meant to allow
  // a caller to do (createRun/advanceRun "one tick at a time").
  const prevHomeOverride = process.env.CONSTRUCT_HOME_OVERRIDE;
  process.env.CONSTRUCT_HOME_OVERRIDE = env.HOME;
  let killedRun;
  try {
    const flow = defineFlow((await import(flowPath)).default);
    killedRun = startRun(env.project, 'crash-run-1', flow, { count: 0 });
    killedRun = await advanceRun(killedRun);
    checkpointRun(env.project, 'crash-run-1', flow, killedRun);
  } finally {
    if (prevHomeOverride === undefined) delete process.env.CONSTRUCT_HOME_OVERRIDE;
    else process.env.CONSTRUCT_HOME_OVERRIDE = prevHomeOverride;
  }

  assert.equal(killedRun.status, 'running', 'the simulated crash happens mid-flow, not after completion');
  assert.deepEqual(readMarkers(markerPath), ['a'], 'only step "a" ran before the simulated crash');

  // "Restart": a brand-new OS process (the real CLI binary), never sharing
  // memory with the run driven above, resumes purely from the checkpoint file.
  const result = spawnSync(process.execPath, [CLI, 'flow', 'resume', 'crash-run-1', `--flow=${flowPath}`], {
    cwd: env.project,
    env: sterileSpawnEnv({ HOME: env.HOME, CONSTRUCT_HOME_OVERRIDE: env.HOME }),
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, `construct flow resume must exit 0; stderr: ${result.stderr}`);
  assert.match(result.stdout, /Resumed run crash-run-1/);
  assert.match(result.stdout, /Status: completed/);

  assert.deepEqual(readMarkers(markerPath), ['a', 'b', 'c'], 'steps b and c ran after resume, and step a was never re-entered');

  const finalCheckpoint = loadCheckpointInSandbox(env, 'crash-run-1');
  assert.equal(finalCheckpoint.run.status, 'completed');
  assert.equal(finalCheckpoint.run.state.count, 3);
  assert.deepEqual(finalCheckpoint.run.completed, ['a', 'b', 'c']);
});

test('construct flow status reports a checkpoint\'s persisted state without driving it further', async (t) => {
  const env = sandbox();
  t.after(() => env.cleanup());
  const markerPath = join(env.project, 'steps.log');
  const flowPath = writeFlowModule(env.project, markerPath);

  const startResult = spawnSync(process.execPath, [CLI, 'flow', 'resume', 'status-run-1', `--flow=${flowPath}`, '--state={"count":0}'], {
    cwd: env.project,
    env: sterileSpawnEnv({ HOME: env.HOME, CONSTRUCT_HOME_OVERRIDE: env.HOME }),
    encoding: 'utf8',
  });
  assert.equal(startResult.status, 0);

  const statusResult = spawnSync(process.execPath, [CLI, 'flow', 'status', 'status-run-1'], {
    cwd: env.project,
    env: sterileSpawnEnv({ HOME: env.HOME, CONSTRUCT_HOME_OVERRIDE: env.HOME }),
    encoding: 'utf8',
  });
  assert.equal(statusResult.status, 0);
  assert.match(statusResult.stdout, /Status: completed/);
  assert.match(statusResult.stdout, /Completed steps: a, b, c/);
});
