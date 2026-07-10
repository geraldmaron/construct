/**
 * tests/functional/flow-join-resume.functional.test.mjs — flow-engine fan-out,
 * and-join, and terminal-status semantics across a real CLI resume
 * (construct-rf26.22, extending the linear crash/resume coverage in
 * tests/functional/flow-checkpoint-resume.functional.test.mjs).
 *
 * Three pins the existing suite leaves open:
 *   1. joinProgress (a Map of Sets on the live Run) survives checkpoint
 *      serialization across a real process boundary: a run crashed after one
 *      fan-out branch resumes via the spawned `construct flow resume` binary,
 *      the remaining branch runs, and the and-join fires exactly once — never
 *      zero times (lost join progress) and never before both branches landed.
 *   2. Resuming a checkpoint against a different flow id fails loudly through
 *      the real CLI (non-zero exit, both ids named) and leaves the checkpoint
 *      file and step side effects untouched — no silent replay against the
 *      wrong step graph. tests/flows-checkpoint.test.mjs pins the in-process
 *      throw; the CLI surface was unpinned.
 *   3. A budget-exhausted run is terminal through the CLI: resume exits 1,
 *      `flow status` reports the persisted terminal status, and a second
 *      resume does not re-drive the step (side-effect marker count unchanged).
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
  const root = mkdtempSync(join(tmpdir(), 'flow-join-resume-'));
  const HOME = join(root, 'HOME');
  const project = join(root, 'project');
  mkdirSync(HOME, { recursive: true });
  mkdirSync(project, { recursive: true });
  return { root, HOME, project, cleanup() { rmTmpDir(root); } };
}

// Diamond flow: seed fans out to left+right via a router array, and join
// declares waitFor {mode:'all'} on both branches. Each step appends its own
// name to a marker file, so "did the join fire exactly once, only after both
// branches" is provable from disk, independent of the engine's bookkeeping.

function writeJoinFlowModule(project, markerPath, flowId = 'join-demo') {
  const flowPath = join(project, `${flowId}.mjs`);
  writeFileSync(flowPath, `
    import fs from 'node:fs';
    function markStep(name) {
      fs.appendFileSync(${JSON.stringify(markerPath)}, name + '\\n');
    }
    export default {
      id: ${JSON.stringify(flowId)},
      stateSchema: { type: 'object', properties: { count: { type: 'integer' } } },
      startStep: 'seed',
      steps: {
        seed: { workerBackend: 'inline', run: (input, ctx) => { markStep('seed'); return { state: { count: (ctx.state.count || 0) + 1 } }; }, router: () => ['left', 'right'] },
        left: { workerBackend: 'inline', run: (input, ctx) => { markStep('left'); return { state: { count: (ctx.state.count || 0) + 1 } }; }, router: () => 'join' },
        right: { workerBackend: 'inline', run: (input, ctx) => { markStep('right'); return { state: { count: (ctx.state.count || 0) + 1 } }; }, router: () => 'join' },
        join: { workerBackend: 'inline', waitFor: { mode: 'all', steps: ['left', 'right'] }, run: (input, ctx) => { markStep('join'); return { state: { count: (ctx.state.count || 0) + 1 } }; }, router: () => '@@flow/terminal' },
      },
    };
  `);
  return flowPath;
}

function readMarkers(markerPath) {
  if (!existsSync(markerPath)) return [];
  return readFileSync(markerPath, 'utf8').trim().split('\n').filter(Boolean);
}

// loadCheckpoint and the pre-crash in-process drive resolve the machine-scoped
// state root (ADR-0066) from process.env.CX_HOME_OVERRIDE directly, so both
// must pin the same override the spawned CLI sees (mirrors
// tests/functional/flow-checkpoint-resume.functional.test.mjs).

async function withHomeOverride(HOME, fn) {
  const prev = process.env.CX_HOME_OVERRIDE;
  process.env.CX_HOME_OVERRIDE = HOME;
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env.CX_HOME_OVERRIDE;
    else process.env.CX_HOME_OVERRIDE = prev;
  }
}

function spawnFlowCli(env, args) {
  return spawnSync(process.execPath, [CLI, 'flow', ...args], {
    cwd: env.project,
    env: sterileSpawnEnv({ HOME: env.HOME, CX_HOME_OVERRIDE: env.HOME }),
    encoding: 'utf8',
    timeout: 60_000,
  });
}

test('a fan-out run crashed after one branch resumes via the real CLI and fires the and-join exactly once', async (t) => {
  const env = sandbox();
  t.after(() => env.cleanup());

  const markerPath = join(env.project, 'steps.log');
  const flowPath = writeJoinFlowModule(env.project, markerPath);

  // Pre-crash drive: two ticks (seed, then left — declaration order), then a
  // checkpoint, then the simulated death. joinProgress now holds join←{left}.
  const killedRun = await withHomeOverride(env.HOME, async () => {
    const flow = defineFlow((await import(flowPath)).default);
    let run = startRun(env.project, 'join-run-1', flow, { count: 0 });
    run = await advanceRun(run);
    run = await advanceRun(run);
    checkpointRun(env.project, 'join-run-1', flow, run);
    return run;
  });

  assert.equal(killedRun.status, 'running', 'the crash happens mid-flow with the join still unsatisfied');
  assert.deepEqual(readMarkers(markerPath), ['seed', 'left'], 'only seed and the first branch ran before the crash');

  const persisted = await withHomeOverride(env.HOME, () => loadCheckpoint(env.project, 'join-run-1'));
  assert.deepEqual(
    persisted.run.joinProgress,
    [['join', ['left']]],
    'the checkpoint serializes partial join progress (Map of Sets → arrays), not an empty structure',
  );
  assert.deepEqual(persisted.run.frontier, ['right'], 'the join itself is held out of the persisted frontier until both branches land');

  const result = spawnFlowCli(env, ['resume', 'join-run-1', `--flow=${flowPath}`]);
  assert.equal(result.status, 0, `construct flow resume must exit 0; stderr: ${result.stderr}`);
  assert.match(result.stdout, /Resumed run join-run-1/);
  assert.match(result.stdout, /Status: completed/);

  assert.deepEqual(
    readMarkers(markerPath),
    ['seed', 'left', 'right', 'join'],
    'resume ran only the remaining branch and then the join — each step exactly once, join only after both branches',
  );

  const final = await withHomeOverride(env.HOME, () => loadCheckpoint(env.project, 'join-run-1'));
  assert.equal(final.run.status, 'completed');
  assert.equal(final.run.state.count, 4);
  assert.deepEqual([...final.run.completed].sort(), ['join', 'left', 'right', 'seed']);
});

test('resuming a checkpoint against a different flow id fails loudly via the CLI and replays nothing', async (t) => {
  const env = sandbox();
  t.after(() => env.cleanup());

  const markerPath = join(env.project, 'steps.log');
  const flowPath = writeJoinFlowModule(env.project, markerPath, 'join-demo');
  const impostorPath = writeJoinFlowModule(env.project, join(env.project, 'impostor.log'), 'impostor-flow');

  await withHomeOverride(env.HOME, async () => {
    const flow = defineFlow((await import(flowPath)).default);
    let run = startRun(env.project, 'mismatch-run-1', flow, { count: 0 });
    run = await advanceRun(run);
    checkpointRun(env.project, 'mismatch-run-1', flow, run);
  });
  const before = await withHomeOverride(env.HOME, () => loadCheckpoint(env.project, 'mismatch-run-1'));

  const result = spawnFlowCli(env, ['resume', 'mismatch-run-1', `--flow=${impostorPath}`]);
  assert.notEqual(result.status, 0, `resume against the wrong flow id must not exit 0; stdout: ${result.stdout}`);
  assert.match(result.stderr, /was recorded against flow "join-demo", not "impostor-flow"/);

  assert.deepEqual(readMarkers(markerPath), ['seed'], 'no step from either flow ran during the refused resume');
  assert.equal(existsSync(join(env.project, 'impostor.log')), false, 'the impostor flow never executed a step');

  const after = await withHomeOverride(env.HOME, () => loadCheckpoint(env.project, 'mismatch-run-1'));
  assert.deepEqual(after.run, before.run, 'the refused resume leaves the persisted checkpoint byte-for-byte semantics intact');
});

test('a budget-exhausted run is terminal through the CLI: status reports it and a second resume does not re-drive', async (t) => {
  const env = sandbox();
  t.after(() => env.cleanup());

  const markerPath = join(env.project, 'steps.log');
  const flowPath = join(env.project, 'budget-loop-flow.mjs');
  writeFileSync(flowPath, `
    import fs from 'node:fs';
    export default {
      id: 'budget-loop',
      stateSchema: { type: 'object', properties: { count: { type: 'integer' } } },
      startStep: 'loop',
      steps: {
        loop: {
          workerBackend: 'inline',
          budget: 1,
          run: (input, ctx) => { fs.appendFileSync(${JSON.stringify(markerPath)}, 'loop\\n'); return { state: { count: (ctx.state.count || 0) + 1 }, usage: { consumed: 1 } }; },
          router: () => 'loop',
        },
      },
    };
  `);

  const first = spawnFlowCli(env, ['resume', 'budget-run-1', `--flow=${flowPath}`, '--state={"count":0}']);
  assert.equal(first.status, 1, `budget exhaustion must surface as exit 1; stdout: ${first.stdout}`);
  assert.match(first.stdout, /Status: budget-exhausted/);
  assert.match(first.stdout, /BUDGET_EXHAUSTED/);
  assert.deepEqual(readMarkers(markerPath), ['loop'], 'the step body ran exactly once before the budget gate fired');

  const status = spawnFlowCli(env, ['status', 'budget-run-1']);
  assert.equal(status.status, 0, `flow status must exit 0; stderr: ${status.stderr}`);
  assert.match(status.stdout, /Status: budget-exhausted/);

  const second = spawnFlowCli(env, ['resume', 'budget-run-1', `--flow=${flowPath}`]);
  assert.equal(second.status, 1, 'a terminal run resumed again still reports the terminal status via exit 1');
  assert.match(second.stdout, /Status: budget-exhausted/);
  assert.deepEqual(readMarkers(markerPath), ['loop'], 'the second resume never re-entered the exhausted step');
});
