#!/usr/bin/env node
/**
 * harness.mjs (spike e-recovery) — a real, resumable
 * multi-step workflow: dispatch -> execution -> artifact production ->
 * approval -> external write (simulated) -> integration -> graph update.
 *
 * Runs as its own process (spawned by run-matrix.mjs) so a "crash" can be a
 * genuine SIGKILL from outside — not a caught exception, not a narrated
 * skip. Every stage transition is checkpointed to <run-dir>/state.json via
 * writeJsonAtomic (lib/state-io.mjs) before the next stage starts, so a
 * fresh invocation against the same --run-dir resumes from the last
 * committed checkpoint: stages already marked complete are skipped, never
 * re-executed.
 *
 * Two-phase stages (execution, external_write, graph_update) write a
 * "phase1" marker after starting but before the side-effecting work
 * commits, so the driver can time a SIGKILL precisely mid-stage (poll for
 * the marker, then kill) rather than racing a sleep. Stage-boundary crash
 * points (dispatch, approval, integration) are killed by the driver
 * immediately after spawn with no marker needed, since the crash must land
 * before the stage does anything.
 *
 * Cancellation (<run-dir>/CANCEL file) and supersession (objective lock at
 * <objective-dir>/lock.json naming a different runId) are checked at every
 * stage boundary; either causes a clean stop, cleanup of tmp/ markers, and
 * state.status set accordingly — distinct from a crash, which leaves
 * whatever was last checkpointed and relies on resume, not cleanup, to
 * finish correctly.
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  sha256, nowIso, sleep, readJson, writeJsonAtomic, appendHistory,
  writeMarker, hasMarker, removeMarker, tmpDir,
} from './lib/state-io.mjs';
import { applyGraphDelta } from './lib/graph-adapter.mjs';

const STAGES = ['dispatch', 'execution', 'artifact', 'approval', 'external_write', 'integration', 'graph_update'];

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const val = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
      out[key] = val;
    }
  }
  return out;
}

function statePath(runDir) { return path.join(runDir, 'state.json'); }

function loadState(runDir) {
  return readJson(statePath(runDir), null);
}

function saveState(runDir, state) {
  state.updatedAt = nowIso();
  writeJsonAtomic(statePath(runDir), state);
}

function log(runDir, event, extra = {}) {
  appendHistory(runDir, { event, ...extra });
}

function maybeCrash(crashAt, point, runDir) {
  if (crashAt === point) {
    log(runDir, 'crash-injected', { point });
    process.kill(process.pid, 'SIGKILL');
    // Unreachable in practice — SIGKILL is not catchable — but keep the
    // process from racing ahead if delivery is ever delayed by the OS.
    return new Promise(() => {});
  }
  return null;
}

function cleanupTmp(runDir) {
  const dir = tmpDir(runDir);
  if (!fs.existsSync(dir)) return;
  for (const f of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, f));
}

function checkCancelled(runDir) {
  return fs.existsSync(path.join(runDir, 'CANCEL'));
}

function checkSuperseded(state, opts) {
  if (!opts.objectiveDir) return false;
  const lock = readJson(path.join(opts.objectiveDir, 'lock.json'), null);
  if (!lock) return false;
  return lock.holderRunId !== state.runId;
}

function stopWithStatus(runDir, state, status, reason) {
  cleanupTmp(runDir);
  state.status = status;
  state.stoppedReason = reason;
  saveState(runDir, state);
  log(runDir, 'stopped', { status, reason });
}

// --- stage implementations -------------------------------------------------

function stageDispatch(state, ctx) {
  const spec = readJson(path.join(ctx.runDir, 'input', 'spec.json'));
  const plan = readJson(path.join(ctx.runDir, 'input', 'plan.json'));
  state.specHash = sha256(JSON.stringify(spec));
  state.planHash = sha256(JSON.stringify(plan));
  state.objectiveId = spec.objectiveId;
  state.credential = {
    token: `tok-${state.runId}`,
    expiresAt: Date.now() + (ctx.credentialTtlMs ?? 5 * 60 * 1000),
  };
  if (ctx.objectiveDir) {
    fs.mkdirSync(ctx.objectiveDir, { recursive: true });
    writeJsonAtomic(path.join(ctx.objectiveDir, 'lock.json'), { holderRunId: state.runId, acquiredAt: nowIso() });
  }
  state.stages.dispatch = 'complete';
  log(ctx.runDir, 'dispatch-complete', { specHash: state.specHash, planHash: state.planHash });
}

async function stageExecution(state, ctx) {
  const specPath = path.join(ctx.runDir, 'input', 'spec.json');
  const spec = readJson(specPath);
  const currentHash = sha256(JSON.stringify(spec));
  if (currentHash !== state.specHash) {
    state.stages.execution = 'blocked_spec_changed';
    log(ctx.runDir, 'blocked-spec-changed', { dispatchHash: state.specHash, currentHash });
    return;
  }
  writeMarker(ctx.runDir, 'execution.phase1');
  log(ctx.runDir, 'execution-started');
  await sleep(ctx.stageDelayMs ?? 30);
  const output = { transformed: spec.body.toUpperCase(), sourceHash: currentHash };
  writeJsonAtomic(path.join(ctx.runDir, 'tmp', 'execution-output.json'), output);
  writeMarker(ctx.runDir, 'execution.phase2');

  // Crash after the real transform commits, before the stage is marked
  // complete — resume re-enters this whole function (stages.execution is
  // still 'pending'), re-running the deterministic transform and
  // overwriting execution-output.json with byte-identical content: proof
  // that a mid-stage crash's forced re-execution is idempotent here too.
  await maybeCrash(ctx.crashAt, 'during_execution', ctx.runDir);

  state.stages.execution = 'complete';
  removeMarker(ctx.runDir, 'execution.phase1');
  removeMarker(ctx.runDir, 'execution.phase2');
  log(ctx.runDir, 'execution-complete');
}

function stageArtifact(state, ctx) {
  const output = readJson(path.join(ctx.runDir, 'tmp', 'execution-output.json'));
  const artifactDir = path.join(ctx.runDir, 'artifact');
  fs.mkdirSync(artifactDir, { recursive: true });
  const content = `# ${state.objectiveId}\n\n${output.transformed}\n`;
  const artifactPath = path.join(artifactDir, 'doc.md');
  fs.writeFileSync(artifactPath, content);
  const hash = sha256(content);
  state.artifact = { hash, path: artifactPath, producedAt: nowIso() };
  saveState(ctx.runDir, state);
  log(ctx.runDir, 'artifact-content-written', { hash });

  // Checkpoint 1/2: content committed, notification not yet sent — this is
  // the "after artifact production" crash point.
  maybeCrashSync(ctx.crashAt, 'after_artifact_production', ctx.runDir);

  const reqPath = path.join(ctx.runDir, 'approvalRequests.json');
  const existing = readJson(reqPath, { count: 0 });
  if (existing.artifactHash !== hash) {
    writeJsonAtomic(reqPath, { artifactHash: hash, requestedAt: nowIso(), count: (existing.count || 0) + 1 });
    log(ctx.runDir, 'approval-requested', { artifactHash: hash });
  } else {
    log(ctx.runDir, 'approval-request-already-sent-skipped', { artifactHash: hash });
  }
  state.stages.artifact = 'complete';
}

// Synchronous crash injection for stage-boundary points where no async
// marker/poll dance is needed — the driver kills right after spawn instead.
function maybeCrashSync(crashAt, point, runDir) {
  if (crashAt === point) {
    log(runDir, 'crash-injected', { point });
    process.kill(process.pid, 'SIGKILL');
  }
}

function stageApproval(state, ctx) {
  maybeCrashSync(ctx.crashAt, 'before_approval', ctx.runDir);

  const plan = readJson(path.join(ctx.runDir, 'input', 'plan.json'));
  const currentPlanHash = sha256(JSON.stringify(plan));
  if (currentPlanHash !== state.planHash) {
    state.stages.approval = 'blocked_plan_changed';
    log(ctx.runDir, 'blocked-plan-changed', { dispatchHash: state.planHash, currentHash: currentPlanHash });
    return;
  }

  const grantPath = path.join(ctx.runDir, 'approvals', 'grant.json');
  const grant = readJson(grantPath, null);
  if (!grant) {
    state.stages.approval = 'awaiting_approval';
    log(ctx.runDir, 'awaiting-approval');
    return;
  }
  if (grant.approvedArtifactHash !== state.artifact.hash) {
    // Stale approval: the artifact has moved on since this grant was
    // issued. Reject rather than silently honor it, and invalidate the
    // grant so a fresh approval must be requested for the current hash.
    fs.renameSync(grantPath, path.join(ctx.runDir, 'approvals', 'grant.rejected-stale.json'));
    state.stages.approval = 'rejected_stale';
    log(ctx.runDir, 'approval-rejected-stale', { grantedFor: grant.approvedArtifactHash, currentHash: state.artifact.hash });
    return;
  }
  state.approval = { grantedAt: grant.grantedAt, token: grant.token, approvedArtifactHash: grant.approvedArtifactHash };
  state.stages.approval = 'complete';
  log(ctx.runDir, 'approval-complete');
}

async function stageExternalWrite(state, ctx) {
  if (Date.now() > state.credential.expiresAt) {
    state.stages.external_write = 'blocked_credential_expired';
    log(ctx.runDir, 'blocked-credential-expired', { expiresAt: state.credential.expiresAt, now: Date.now() });
    return;
  }
  writeMarker(ctx.runDir, 'external_write.phase1');
  log(ctx.runDir, 'external-write-started');
  await sleep(ctx.stageDelayMs ?? 30);

  const recordsPath = path.join(ctx.runDir, 'external', 'records.json');
  fs.mkdirSync(path.dirname(recordsPath), { recursive: true });
  const records = readJson(recordsPath, {});
  const recordId = state.runId;
  const prior = records[recordId];
  records[recordId] = {
    status: 'WRITTEN',
    artifactHash: state.artifact.hash,
    updatedAt: nowIso(),
    applyCount: (prior?.applyCount || 0) + 1,
  };
  writeJsonAtomic(recordsPath, records);
  writeMarker(ctx.runDir, 'external_write.phase2');

  // Crash after the upsert commits, before the stage is marked complete —
  // resume re-enters this whole function (stages.external_write is still
  // 'pending') and performs a second real write to the same recordId. The
  // upsert-by-recordId shape is what makes that second write idempotent:
  // applyCount increments (proving it ran twice) but status/artifactHash and
  // the record count stay identical to a single clean run.
  await maybeCrash(ctx.crashAt, 'during_external_write', ctx.runDir);

  state.externalWrite = { recordId, done: true };
  state.stages.external_write = 'complete';
  removeMarker(ctx.runDir, 'external_write.phase1');
  removeMarker(ctx.runDir, 'external_write.phase2');
  log(ctx.runDir, 'external-write-complete', { recordId, applyCount: records[recordId].applyCount });
}

function stageIntegration(state, ctx) {
  maybeCrashSync(ctx.crashAt, 'before_integration', ctx.runDir);

  if (state.approval.approvedArtifactHash !== state.artifact.hash) {
    state.stages.integration = 'blocked_stale_approval';
    log(ctx.runDir, 'blocked-stale-approval-at-integration', {
      approvedFor: state.approval.approvedArtifactHash, currentHash: state.artifact.hash,
    });
    return;
  }
  const kbPath = path.join(ctx.runDir, 'integrated', 'knowledge.md');
  fs.mkdirSync(path.dirname(kbPath), { recursive: true });
  const marker = `${state.runId}:${state.artifact.hash}`;
  const existing = fs.existsSync(kbPath) ? fs.readFileSync(kbPath, 'utf8') : '';
  if (existing.includes(marker)) {
    log(ctx.runDir, 'integration-already-applied-skipped', { marker });
  } else {
    fs.appendFileSync(kbPath, `- ${marker} integrated at ${nowIso()}\n`);
    log(ctx.runDir, 'integration-applied', { marker });
  }
  state.stages.integration = 'complete';
}

async function stageGraphUpdate(state, ctx) {
  const workId = `work:${state.objectiveId}`;
  const artifactId = `artifact:${state.runId}`;
  writeJsonAtomic(path.join(ctx.runDir, 'tmp', 'graph-seed.json'), { workId, artifactId, artifactHash: state.artifact.hash });
  writeMarker(ctx.runDir, 'graph_update.phase1');
  log(ctx.runDir, 'graph-update-started');
  await sleep(ctx.stageDelayMs ?? 30);

  const drain = applyGraphDelta(ctx.graphRootDir, { workId, artifactId, artifactHash: state.artifact.hash, runId: state.runId });
  writeMarker(ctx.runDir, 'graph_update.phase2');

  // Crash after the outbox enqueue+drain commits to SQLite, before the
  // stage is marked complete — resume re-enters this function and drains
  // the identical node/edge set a second time. Outbox upsert semantics
  // (lib/graph/relational/sqlite-store.mjs) make that second drain an
  // idempotent no-op on content, not a duplicate node.
  await maybeCrash(ctx.crashAt, 'during_graph_update', ctx.runDir);

  state.graphUpdate = { done: true, workId, artifactId, drain };
  state.stages.graph_update = 'complete';
  removeMarker(ctx.runDir, 'graph_update.phase1');
  removeMarker(ctx.runDir, 'graph_update.phase2');
  log(ctx.runDir, 'graph-update-complete', { workId, artifactId, drain });
}

const STAGE_FNS = {
  dispatch: stageDispatch,
  execution: stageExecution,
  artifact: stageArtifact,
  approval: stageApproval,
  external_write: stageExternalWrite,
  integration: stageIntegration,
  graph_update: stageGraphUpdate,
};

// A stage's outcome can be 'complete' (advance), a 'blocked_*'/'awaiting_*'
// pause (stop the run cleanly, not an error — the driver decides whether to
// fix the condition and resume), or throw (unexpected failure).
function isBlocked(status) {
  return typeof status === 'string' && status !== 'complete';
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const runDir = path.resolve(args['run-dir']);
  const objectiveDir = args['objective-dir'] ? path.resolve(args['objective-dir']) : null;
  const crashAt = args['crash-at'] || null;
  const runId = args['run-id'];
  const credentialTtlMs = args['credential-ttl-ms'] ? Number(args['credential-ttl-ms']) : undefined;
  const graphRootDir = path.resolve(args['graph-root-dir'] || path.join(runDir, 'project'));
  fs.mkdirSync(graphRootDir, { recursive: true });

  if (!runId) { console.error('--run-id is required'); process.exit(2); }

  // stopAfterStage is test orchestration, not a crash: it exits cleanly right
  // after the named stage reaches 'complete', so the driver can inject an
  // out-of-band mutation (edit an input file, drift the artifact) at an
  // exact stage boundary without a real interruption. run-matrix.mjs is the
  // only caller.
  const stopAfterStage = args['stop-after-stage'] || null;

  const ctx = { runDir, objectiveDir, crashAt, graphRootDir, credentialTtlMs, stageDelayMs: args['stage-delay-ms'] ? Number(args['stage-delay-ms']) : undefined };

  maybeCrashSync(crashAt, 'before_dispatch', runDir);

  let state = loadState(runDir);
  const resuming = state != null;
  if (!state) {
    state = { runId, stages: Object.fromEntries(STAGES.map((s) => [s, 'pending'])), status: 'running' };
  } else {
    // A loaded checkpoint's status may read 'blocked' from whatever paused
    // the prior invocation (awaiting_approval, a stale credential, etc.).
    // Reset to 'running' on every fresh attempt rather than trust it: the
    // condition that caused the prior pause may already be resolved
    // out-of-band, and the loop below re-derives the real status (blocked/
    // done/cancelled/superseded) from what actually happens this attempt.
    state.status = 'running';
  }
  saveState(runDir, state);
  log(runDir, resuming ? 'resume' : 'start', { runId, crashAt: crashAt || null });

  for (const stageName of STAGES) {
    if (checkCancelled(runDir)) { stopWithStatus(runDir, state, 'cancelled', 'cancel-flag observed'); return; }
    // The dispatch stage is what claims the objective lock for this run in
    // the first place — checking supersession before it has ever run would
    // reject a brand-new run against a lock an earlier run already holds,
    // which is backwards. Every later stage boundary checks normally.
    if (stageName !== 'dispatch' && checkSuperseded(state, ctx)) {
      stopWithStatus(runDir, state, 'superseded', 'objective lock held by another run');
      return;
    }

    const current = state.stages[stageName];
    if (current === 'complete') {
      log(runDir, 'skip-already-complete', { stage: stageName });
      continue;
    }
    if (isBlocked(current) && current !== 'pending') {
      // A blocked stage (awaiting_approval, blocked_spec_changed, etc.) is
      // re-evaluated on resume rather than assumed still blocked — the
      // condition that caused it may have been resolved out-of-band (a
      // grant supplied, source reverted).
      log(runDir, 'reevaluate-blocked-stage', { stage: stageName, previousStatus: current });
    }

    saveState(runDir, state);
    const fn = STAGE_FNS[stageName];
    await fn(state, ctx);
    saveState(runDir, state);

    if (isBlocked(state.stages[stageName])) {
      state.status = 'blocked';
      saveState(runDir, state);
      log(runDir, 'run-blocked', { stage: stageName, status: state.stages[stageName] });
      return;
    }

    if (stopAfterStage === stageName) {
      log(runDir, 'stopped-after-stage-for-fixture', { stage: stageName });
      return;
    }
  }

  cleanupTmp(runDir);
  state.status = 'done';
  saveState(runDir, state);
  log(runDir, 'run-complete');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
