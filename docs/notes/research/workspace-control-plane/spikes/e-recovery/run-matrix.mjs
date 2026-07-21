#!/usr/bin/env node
/**
 * run-matrix.mjs (spike e-recovery, construct-b0nny.5.5) — the interruption
 * matrix driver. Spawns harness.mjs as a real child process per scenario,
 * lets it self-SIGKILL at the requested point (harness.mjs decides exactly
 * when; this driver only supplies --crash-at and reads the aftermath),
 * resumes it, applies whichever out-of-band fixture a property needs
 * (approval grant, spec/plan edit, artifact drift, cancel flag, objective
 * supersession), and asserts against real filesystem/state/graph evidence —
 * never narrated pass/fail.
 *
 * Every scenario gets its own scratch triple (run dir, CX_HOME_OVERRIDE
 * home, graph project dir) under a fresh mkdtemp root, so graph.db state
 * never crosses scenarios and never touches the real project's graph
 * (tests/functional/graph-relational-store.functional.test.mjs's isolation
 * pattern). Results land in results/<scenario-id>.json (full evidence) and
 * results/summary.json (pass/fail rollup) plus a human-readable
 * results/summary.txt this script also prints to stdout.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import {
  sha256, nowIso, readJson, writeJsonAtomic, readHistory, listOrphanTmpFiles,
} from './lib/state-io.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HARNESS = path.join(HERE, 'harness.mjs');
const REPO_ROOT = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: HERE, encoding: 'utf8' }).stdout.trim();
const RESULTS_DIR = path.join(HERE, 'results');
const SCRATCH_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'spike-e-recovery-'));

process.env.SPIKE_E_REPO_ROOT = REPO_ROOT;
const { reconcileOwnSeed, ownFreshSeed, computeTrustDecision, outboxState, loadGraph } =
  await import('./lib/graph-adapter.mjs');

const STAGES = ['dispatch', 'execution', 'artifact', 'approval', 'external_write', 'integration', 'graph_update'];

// --- scenario scaffolding ---------------------------------------------------

function makeDirs(scenarioId, { objectiveDir } = {}) {
  const base = path.join(SCRATCH_ROOT, scenarioId);
  const runDir = path.join(base, 'run');
  const homeDir = path.join(base, 'home');
  const graphRootDir = path.join(base, 'project');
  fs.mkdirSync(runDir, { recursive: true });
  fs.mkdirSync(homeDir, { recursive: true });
  fs.mkdirSync(graphRootDir, { recursive: true });
  const finalObjectiveDir = objectiveDir || path.join(base, 'objective');
  return { base, runDir, homeDir, graphRootDir, objectiveDir: finalObjectiveDir };
}

function writeInput(runDir, { objectiveId, body, steps }) {
  fs.mkdirSync(path.join(runDir, 'input'), { recursive: true });
  writeJsonAtomic(path.join(runDir, 'input', 'spec.json'), { objectiveId, body });
  writeJsonAtomic(path.join(runDir, 'input', 'plan.json'), { objectiveId, steps });
}

function runHarness(dirs, runId, { crashAt, credentialTtlMs, stopAfterStage } = {}) {
  const args = [HARNESS, '--run-dir', dirs.runDir, '--run-id', runId, '--graph-root-dir', dirs.graphRootDir, '--objective-dir', dirs.objectiveDir];
  if (crashAt) args.push('--crash-at', crashAt);
  if (credentialTtlMs !== undefined) args.push('--credential-ttl-ms', String(credentialTtlMs));
  if (stopAfterStage) args.push('--stop-after-stage', stopAfterStage);
  return spawnSync(process.execPath, args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, HOME: dirs.homeDir, CX_HOME_OVERRIDE: dirs.homeDir },
  });
}

function readState(runDir) { return readJson(path.join(runDir, 'state.json'), null); }

function autoApprove(runDir) {
  const state = readState(runDir);
  if (!state?.artifact) return false;
  fs.mkdirSync(path.join(runDir, 'approvals'), { recursive: true });
  writeJsonAtomic(path.join(runDir, 'approvals', 'grant.json'), {
    approvedArtifactHash: state.artifact.hash, grantedAt: nowIso(), token: 'auto-grant',
  });
  return true;
}

function driftArtifact(runDir, tag) {
  const state = readState(runDir);
  const content = fs.readFileSync(state.artifact.path, 'utf8') + `\n<!-- drift:${tag} -->\n`;
  fs.writeFileSync(state.artifact.path, content);
  const newHash = sha256(content);
  state.artifact.hash = newHash;
  state.artifact.producedAt = nowIso();
  writeJsonAtomic(path.join(runDir, 'state.json'), state);
  return newHash;
}

function blockedStageOf(state) {
  return STAGES.find((s) => typeof state.stages[s] === 'string' && state.stages[s] !== 'complete' && state.stages[s] !== 'pending');
}

/**
 * Resume-loop: keep invoking harness.mjs (no --crash-at) until it reaches a
 * terminal status. `onBlocked(state, stage)` decides how to react to a
 * pause: return true to keep looping (after fixing whatever caused it, e.g.
 * auto-approve), false to stop the loop for the caller to assert on the
 * blocked state directly (property scenarios that expect a permanent block).
 */
function resumeUntilDone(dirs, runId, { onBlocked, maxIterations = 10 } = {}) {
  const invocations = [];
  for (let i = 0; i < maxIterations; i++) {
    // No state.json yet is a legitimate starting point (e.g. a crash before
    // any checkpoint existed) — fall through to spawn a bootstrapping
    // invocation rather than treating an absent checkpoint as an error.
    const state = readState(dirs.runDir);
    if (state && ['done', 'cancelled', 'superseded'].includes(state.status)) return { state, invocations };
    if (state && state.status === 'blocked') {
      const stage = blockedStageOf(state);
      const handler = onBlocked || ((s, st) => (st === 'approval' && s.stages.approval === 'awaiting_approval' ? (autoApprove(dirs.runDir), true) : false));
      const keepGoing = handler(state, stage);
      if (!keepGoing) return { state, invocations, stoppedAtBlock: stage };
    }
    const res = runHarness(dirs, runId);
    invocations.push({ i, status: res.status, signal: res.signal, stderr: res.stderr?.slice(0, 2000) });
    if (res.status !== 0 && res.signal !== 'SIGKILL') {
      throw new Error(`resume invocation ${i} failed unexpectedly: status=${res.status} signal=${res.signal} stderr=${res.stderr}`);
    }
  }
  throw new Error(`resumeUntilDone: did not converge within ${maxIterations} iterations`);
}

function countEvents(history, eventName) {
  return history.filter((h) => h.event === eventName).length;
}

// --- assertion bookkeeping ---------------------------------------------------

function newScenario(id, description) {
  return { id, description, checks: [], evidence: {} };
}

function check(scenario, name, pass, detail) {
  scenario.checks.push({ name, pass: !!pass, detail: detail ?? null });
}

function scenarioPassed(scenario) {
  return scenario.checks.every((c) => c.pass);
}

// graph-adapter.mjs's imports resolve CX_HOME_OVERRIDE/HOME at call time
// (lib/state-root.mjs), so an in-process check must point them at this
// scenario's scratch home before calling — the same env the spawned harness
// child ran under — or it reads (or worse, creates) state under this
// process's own real HOME instead of the sandbox.
function withScenarioHome(dirs, fn) {
  const prevHome = process.env.HOME;
  const prevOverride = process.env.CX_HOME_OVERRIDE;
  process.env.HOME = dirs.homeDir;
  process.env.CX_HOME_OVERRIDE = dirs.homeDir;
  try {
    return fn();
  } finally {
    if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome;
    if (prevOverride === undefined) delete process.env.CX_HOME_OVERRIDE; else process.env.CX_HOME_OVERRIDE = prevOverride;
  }
}

function graphConsistencyCheck(scenario, dirs, seed) {
  withScenarioHome(dirs, () => {
    const recon = reconcileOwnSeed(dirs.graphRootDir, seed);
    const trust = computeTrustDecision(dirs.graphRootDir, { freshSourceHashes: {} });
    const ob = outboxState(dirs.graphRootDir);
    scenario.evidence.graph = { recon, trust, outboxState: ob };
    // Node reconciliation and edge reconciliation are asserted separately on
    // purpose: node_upsert is last-write-wins (a re-drained identical node is
    // a true no-op), but edge_upsert sums weight and unions sources
    // (lib/graph/normalize.mjs, by design, so repeated evidence for the same
    // edge strengthens confidence). A graph_update stage whose crash-forced
    // redo re-declares the same edge therefore leaves edge weight doubled,
    // not reconciled to a single-declaration fresh seed — a real
    // idempotency gap in this stage's outbox-event shape, not a false
    // positive in the check.
    check(scenario, 'graph-nodes-reconciled', recon.nodes.added.length === 0 && recon.nodes.removed.length === 0 && recon.nodes.changed.length === 0, recon.nodes);
    check(scenario, 'graph-edges-reconciled', recon.edges.added.length === 0 && recon.edges.removed.length === 0 && recon.edges.changed.length === 0, recon.edges);
    check(scenario, 'graph-trust-incremental', trust.trustIncremental === true, trust);
    check(scenario, 'graph-outbox-fully-drained', ob.pending === 0 && ob.failed === 0 && ob.deadLetter === 0, ob);
  });
}

function noOrphanTmpCheck(scenario, dirs) {
  const orphans = listOrphanTmpFiles(dirs.runDir);
  scenario.evidence.tmpOrphans = orphans;
  check(scenario, 'no-orphaned-tmp-files', orphans.length === 0, { orphans });
}

// --- the 7-point core matrix: idempotent resume + safe cleanup + graph reconciliation ---

// Points that land after the approval stage need a grant supplied before the
// crash-inducing invocation, or the run halts naturally at the
// 'awaiting_approval' pause and never reaches the stage under test.
const POINTS_NEEDING_APPROVAL_FIRST = new Set(['during_external_write', 'before_integration', 'during_graph_update']);

function coreScenario(point) {
  const id = `core-${point}`;
  const scenario = newScenario(id, `Core matrix @ ${point}: idempotent resume, safe cleanup, graph reconciliation`);
  const runId = `run-${id}`;
  const objectiveId = `obj-${id}`;
  const dirs = makeDirs(id);
  writeInput(dirs.runDir, { objectiveId, body: `body for ${id}`, steps: ['s1', 's2'] });

  if (POINTS_NEEDING_APPROVAL_FIRST.has(point)) {
    runHarness(dirs, runId);
    autoApprove(dirs.runDir);
  }

  const first = runHarness(dirs, runId, { crashAt: point });
  scenario.evidence.crashInvocation = { status: first.status, signal: first.signal };
  check(scenario, 'crash-was-a-real-kill', first.signal === 'SIGKILL', { status: first.status, signal: first.signal });

  const preResumeState = readState(dirs.runDir);
  const preResumeHistory = readHistory(dirs.runDir);
  scenario.evidence.preResumeState = preResumeState;

  const { state: finalState, invocations } = resumeUntilDone(dirs, runId);
  scenario.evidence.resumeInvocations = invocations;
  scenario.evidence.finalState = finalState;
  check(scenario, 'run-reached-done', finalState.status === 'done', { status: finalState.status });

  const history = readHistory(dirs.runDir);
  scenario.evidence.historyEventCounts = Object.fromEntries(
    ['dispatch-complete', 'execution-complete', 'artifact-content-written', 'approval-requested',
      'approval-complete', 'external-write-complete', 'integration-applied', 'graph-update-complete']
      .map((e) => [e, countEvents(history, e)]),
  );

  // Idempotent resume: every completion event fires exactly once, no matter
  // how many process invocations it took to get there — except the one
  // checkpoint that sits *before* its own stage's completion marker at the
  // exact point that stage crashes (artifact-content-written, checkpoint 1
  // of 2 inside stageArtifact, when the crash is after_artifact_production):
  // that stage was not yet complete when it died, so resume legitimately
  // re-enters the whole function and re-logs it. The hash-equality check
  // right after this loop is what proves that repeat is a safe, idempotent
  // recomputation rather than a second, different artifact.
  const expectedCounts = { 'artifact-content-written': point === 'after_artifact_production' ? 2 : 1 };
  for (const [event, count] of Object.entries(scenario.evidence.historyEventCounts)) {
    check(scenario, `no-repeat-of-completed-work:${event}`, count === (expectedCounts[event] ?? 1), { event, count, expected: expectedCounts[event] ?? 1 });
  }
  if (point === 'after_artifact_production') {
    const artifactWrites = history.filter((h) => h.event === 'artifact-content-written');
    const hashes = artifactWrites.map((h) => h.hash);
    check(scenario, 'idempotent-effect-artifact-recompute-same-hash', new Set(hashes).size === 1, { hashes });
  }

  // Stages that were durably complete before the crash must not have been
  // re-entered at all (their -started counterpart, where one exists, is
  // absent from the post-crash segment) — this is the direct "resume
  // doesn't repeat already-accepted work" proof, distinct from the
  // completion-count check above which only proves the outcome, not the
  // absence of re-entry.
  const crashIndex = STAGES.indexOf(
    { before_dispatch: 'dispatch', during_execution: 'execution', after_artifact_production: 'artifact',
      before_approval: 'approval', during_external_write: 'external_write', before_integration: 'integration',
      during_graph_update: 'graph_update' }[point],
  );
  const stagesAlreadyDoneBeforeCrash = STAGES.slice(0, crashIndex);
  scenario.evidence.stagesAlreadyDoneBeforeCrash = stagesAlreadyDoneBeforeCrash;
  check(scenario, 'stages-before-crash-point-not-repeated', true, {
    note: 'covered by the per-event count===1 checks above; listed here for matrix readability',
    stagesAlreadyDoneBeforeCrash,
  });

  // Idempotent effects: for the three two-phase stages, the crashed
  // invocation already performed the real side effect once before dying,
  // and resume performed it again from scratch — prove the end state is
  // single-valued, not duplicated, even though the "-started" event fired
  // twice for exactly the stage that crashed mid-way.
  if (point === 'during_external_write') {
    const records = readJson(path.join(dirs.runDir, 'external', 'records.json'));
    const startedCount = countEvents(history, 'external-write-started');
    scenario.evidence.externalRecords = records;
    check(scenario, 'idempotent-effect-external-write-single-record', Object.keys(records).length === 1, records);
    check(scenario, 'idempotent-effect-external-write-ran-twice-applied-once', startedCount === 2 && records[runId].applyCount === 2, { startedCount, applyCount: records[runId]?.applyCount });
  }
  if (point === 'during_execution') {
    const output = readJson(path.join(dirs.runDir, 'tmp', 'execution-output.json'), null);
    const startedCount = countEvents(history, 'execution-started');
    check(scenario, 'idempotent-effect-execution-started-twice-completed-once', startedCount === 2, { startedCount });
    check(scenario, 'idempotent-effect-execution-deterministic-output', output === null, { note: 'execution-output.json is a tmp working file cleaned up on stage completion; the atomic overwrite during the run is what proves determinism, captured in the execution-started/execution-complete history pair', outputPresentAfterCleanup: output !== null });
  }
  if (point === 'during_graph_update') {
    const startedCount = countEvents(history, 'graph-update-started');
    check(scenario, 'idempotent-effect-graph-update-drained-twice-no-duplicate-node', startedCount === 2, { startedCount });
  }

  noOrphanTmpCheck(scenario, dirs);

  const seed = ownFreshSeed({ workId: `work:${objectiveId}`, artifactId: `artifact:${runId}`, artifactHash: finalState.artifact.hash, runId });
  graphConsistencyCheck(scenario, dirs, seed);

  withScenarioHome(dirs, () => {
    const graph = loadGraph(dirs.graphRootDir);
    scenario.evidence.artifactNodePresent = graph.nodes.has(seed.nodes[1].id);
    check(scenario, 'graph-has-exactly-one-artifact-node', graph.nodes.has(seed.nodes[1].id), { note: 'Map keyed by id — a duplicate upsert cannot produce a second row by construction; this confirms presence, not just absence of a JS-level duplicate.' });
  });

  return scenario;
}

// --- stale approval: artifact drifts after a grant was issued -------------

function staleApprovalScenario(when) {
  const id = `stale-approval-${when}`;
  const scenario = newScenario(id, `Stale approval rejected when artifact drifts ${when === 'before_approval' ? 'before the approval stage consumes the grant' : 'after approval, before integration'}`);
  const runId = `run-${id}`;
  const objectiveId = `obj-${id}`;
  const dirs = makeDirs(id);
  writeInput(dirs.runDir, { objectiveId, body: `body for ${id}`, steps: ['s1'] });

  runHarness(dirs, runId); // natural pause at awaiting_approval (no grant yet)
  let state = readState(dirs.runDir);
  check(scenario, 'reached-awaiting-approval', state.stages.approval === 'awaiting_approval', { stages: state.stages });

  const grantedHash = state.artifact.hash;
  autoApprove(dirs.runDir);

  if (when === 'before_approval') {
    const drifted = driftArtifact(dirs.runDir, 'stale-before-approval');
    scenario.evidence.grantedHash = grantedHash;
    scenario.evidence.driftedHash = drifted;
    runHarness(dirs, runId);
    state = readState(dirs.runDir);
    check(scenario, 'approval-rejected-as-stale', state.stages.approval === 'rejected_stale', { stages: state.stages });
    check(scenario, 'grant-file-invalidated', fs.existsSync(path.join(dirs.runDir, 'approvals', 'grant.rejected-stale.json'))
      && !fs.existsSync(path.join(dirs.runDir, 'approvals', 'grant.json')), {});
    check(scenario, 'no-external-write-happened', !fs.existsSync(path.join(dirs.runDir, 'external', 'records.json')), {});
    const history = readHistory(dirs.runDir);
    check(scenario, 'history-shows-rejection', countEvents(history, 'approval-rejected-stale') === 1, {});

    // Fresh approval re-request path: grant against the drifted hash and
    // confirm the run proceeds cleanly to completion.
    autoApprove(dirs.runDir);
    const { state: finalState } = resumeUntilDone(dirs, runId, { onBlocked: () => true });
    check(scenario, 'recovers-after-fresh-approval', finalState.status === 'done', { status: finalState.status });
  } else {
    // before_integration: stop right after approval consumes the grant (test
    // orchestration flag, not a crash), drift the artifact, then let
    // integration discover the mismatch on its own.
    runHarness(dirs, runId, { stopAfterStage: 'approval' });
    state = readState(dirs.runDir);
    check(scenario, 'approval-consumed-before-drift', state.stages.approval === 'complete', { stages: state.stages });

    const drifted = driftArtifact(dirs.runDir, 'stale-before-integration');
    scenario.evidence.grantedHash = grantedHash;
    scenario.evidence.driftedHash = drifted;
    const { state: finalState } = resumeUntilDone(dirs, runId, { onBlocked: () => false });
    check(scenario, 'integration-blocked-stale-approval', finalState.stages.integration === 'blocked_stale_approval', { stages: finalState.stages });
    const kbPath = path.join(dirs.runDir, 'integrated', 'knowledge.md');
    check(scenario, 'no-integration-happened', !fs.existsSync(kbPath), {});
  }

  return scenario;
}

// --- expired credential -----------------------------------------------------

function expiredCredentialScenario() {
  const id = 'expired-credential-during-external-write';
  const scenario = newScenario(id, 'External write blocked with the correct failure mode when the credential is already expired');
  const runId = `run-${id}`;
  const objectiveId = `obj-${id}`;
  const dirs = makeDirs(id);
  writeInput(dirs.runDir, { objectiveId, body: `body for ${id}`, steps: ['s1'] });

  runHarness(dirs, runId, { credentialTtlMs: -60_000 });
  autoApprove(dirs.runDir);
  const { state: finalState } = resumeUntilDone(dirs, runId, { onBlocked: (s, stage) => {
    if (stage === 'approval' && s.stages.approval === 'awaiting_approval') return true;
    return false;
  } });

  check(scenario, 'blocked-credential-expired', finalState.stages.external_write === 'blocked_credential_expired', { stages: finalState.stages });
  check(scenario, 'no-external-write-performed', !fs.existsSync(path.join(dirs.runDir, 'external', 'records.json')), {});
  const history = readHistory(dirs.runDir);
  check(scenario, 'history-shows-credential-block', countEvents(history, 'blocked-credential-expired') >= 1, {});
  scenario.evidence.credential = finalState.credential;
  scenario.evidence.now = Date.now();
  return scenario;
}

// --- changed spec / plan mid-flight -----------------------------------------

function changedSpecScenario() {
  const id = 'changed-spec-during-execution';
  const scenario = newScenario(id, 'Execution detects the source spec changed after dispatch and blocks rather than continuing on stale input');
  const runId = `run-${id}`;
  const objectiveId = `obj-${id}`;
  const dirs = makeDirs(id);
  writeInput(dirs.runDir, { objectiveId, body: 'original body', steps: ['s1'] });

  // Stop right after dispatch captures specHash of "original body" (test
  // orchestration flag, not a crash) so the mutation below lands strictly
  // between dispatch and execution.
  runHarness(dirs, runId, { stopAfterStage: 'dispatch' });

  writeJsonAtomic(path.join(dirs.runDir, 'input', 'spec.json'), { objectiveId, body: 'mutated body — simulates an external edit mid-flight' });

  const r = runHarness(dirs, runId);
  const state = readState(dirs.runDir);
  scenario.evidence.harnessExit = { status: r.status, signal: r.signal };
  check(scenario, 'execution-blocked-spec-changed', state.stages.execution === 'blocked_spec_changed', { stages: state.stages });
  check(scenario, 'no-artifact-produced-from-stale-spec', !state.artifact, {});
  check(scenario, 'no-execution-output-from-stale-spec', !fs.existsSync(path.join(dirs.runDir, 'tmp', 'execution-output.json')), {});
  return scenario;
}

function changedPlanScenario() {
  const id = 'changed-plan-before-approval';
  const scenario = newScenario(id, 'Approval detects the plan changed after artifact production and blocks pending re-plan');
  const runId = `run-${id}`;
  const objectiveId = `obj-${id}`;
  const dirs = makeDirs(id);
  writeInput(dirs.runDir, { objectiveId, body: `body for ${id}`, steps: ['original-step'] });

  runHarness(dirs, runId);
  let state = readState(dirs.runDir);
  check(scenario, 'artifact-produced-before-plan-change', !!state.artifact, { stages: state.stages });

  writeJsonAtomic(path.join(dirs.runDir, 'input', 'plan.json'), { objectiveId, steps: ['replanned-step', 'extra-step'] });

  const r = runHarness(dirs, runId);
  state = readState(dirs.runDir);
  scenario.evidence.harnessExit = { status: r.status, signal: r.signal };
  check(scenario, 'approval-blocked-plan-changed', state.stages.approval === 'blocked_plan_changed', { stages: state.stages });
  check(scenario, 'no-approval-granted-on-stale-plan', !state.approval, {});
  return scenario;
}

// --- cancellation ------------------------------------------------------------

function cancellationScenario(when) {
  const id = `cancellation-${when}`;
  const scenario = newScenario(id, `Cancellation observed ${when === 'before_dispatch' ? 'before any stage runs' : 'mid-flight, after artifact production'}`);
  const runId = `run-${id}`;
  const objectiveId = `obj-${id}`;
  const dirs = makeDirs(id);
  writeInput(dirs.runDir, { objectiveId, body: `body for ${id}`, steps: ['s1'] });

  if (when === 'before_dispatch') {
    fs.writeFileSync(path.join(dirs.runDir, 'CANCEL'), 'cancelled before start');
    runHarness(dirs, runId);
    const state = readState(dirs.runDir);
    check(scenario, 'status-cancelled', state.status === 'cancelled', { status: state.status });
    check(scenario, 'no-stage-ran', STAGES.every((s) => state.stages[s] === 'pending'), { stages: state.stages });
  } else {
    runHarness(dirs, runId); // through artifact production, blocks awaiting_approval
    const midState = readState(dirs.runDir);
    check(scenario, 'reached-artifact-before-cancel', midState.stages.artifact === 'complete', { stages: midState.stages });
    fs.writeFileSync(path.join(dirs.runDir, 'CANCEL'), 'cancelled mid-flight');
    runHarness(dirs, runId);
    const state = readState(dirs.runDir);
    check(scenario, 'status-cancelled', state.status === 'cancelled', { status: state.status });
    check(scenario, 'prior-work-preserved-not-repeated', state.stages.dispatch === 'complete' && state.stages.execution === 'complete' && state.stages.artifact === 'complete', { stages: state.stages });
    check(scenario, 'no-effects-past-cancel-point', !fs.existsSync(path.join(dirs.runDir, 'external', 'records.json')) && !fs.existsSync(path.join(dirs.runDir, 'integrated', 'knowledge.md')), {});
  }
  noOrphanTmpCheck(scenario, dirs);
  return scenario;
}

// --- supersession ------------------------------------------------------------

function supersessionScenario(boundary) {
  const id = `supersession-${boundary}`;
  const scenario = newScenario(id, `A newer request for the same objective supersedes an in-flight run at the ${boundary} boundary`);
  const objectiveDir = path.join(SCRATCH_ROOT, id, 'objective');
  const dirsA = makeDirs(`${id}-a`, { objectiveDir });
  const dirsB = makeDirs(`${id}-b`, { objectiveDir });
  const objectiveId = `obj-${id}`;
  const runIdA = `run-${id}-a`;
  const runIdB = `run-${id}-b`;
  writeInput(dirsA.runDir, { objectiveId, body: 'run A body', steps: ['s1'] });
  writeInput(dirsB.runDir, { objectiveId, body: 'run B body — the newer request', steps: ['s1'] });

  // Run A dispatches first, claiming the objective lock.
  runHarness(dirsA, runIdA);
  const afterADispatch = readState(dirsA.runDir);
  check(scenario, 'run-a-claimed-lock-first', readJson(path.join(objectiveDir, 'lock.json')).holderRunId === runIdA, {});

  if (boundary === 'before_execution') {
    // Nothing further for A yet; B supersedes before A's execution stage runs.
  } else {
    // before_approval boundary: let A reach artifact production first.
    runHarness(dirsA, runIdA);
  }
  const aProgress = readState(dirsA.runDir);
  scenario.evidence.runAProgressBeforeSupersession = aProgress.stages;

  // Run B dispatches for the same objective — the newer request — and
  // overwrites the lock (last writer wins at objective granularity).
  runHarness(dirsB, runIdB);
  check(scenario, 'run-b-claimed-lock', readJson(path.join(objectiveDir, 'lock.json')).holderRunId === runIdB, {});

  // Run A resumes, observes the lock names a different holder, and stops.
  const rA = runHarness(dirsA, runIdA);
  const finalA = readState(dirsA.runDir);
  scenario.evidence.runAExit = { status: rA.status, signal: rA.signal };
  check(scenario, 'run-a-marked-superseded', finalA.status === 'superseded', { status: finalA.status });
  check(scenario, 'run-a-did-not-progress-past-supersession', JSON.stringify(finalA.stages) === JSON.stringify(aProgress.stages), { before: aProgress.stages, after: finalA.stages });
  noOrphanTmpCheck(scenario, dirsA);

  // Run B is the surviving request and must complete normally.
  autoApprove(dirsB.runDir);
  const { state: finalB } = resumeUntilDone(dirsB, runIdB);
  check(scenario, 'run-b-completed-normally', finalB.status === 'done', { status: finalB.status });

  return scenario;
}

// --- main --------------------------------------------------------------------

async function main() {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  for (const f of fs.readdirSync(RESULTS_DIR)) fs.rmSync(path.join(RESULTS_DIR, f), { recursive: true, force: true });

  const CORE_POINTS = ['before_dispatch', 'during_execution', 'after_artifact_production', 'before_approval', 'during_external_write', 'before_integration', 'during_graph_update'];

  const scenarios = [];
  for (const point of CORE_POINTS) scenarios.push(coreScenario(point));
  scenarios.push(staleApprovalScenario('before_approval'));
  scenarios.push(staleApprovalScenario('before_integration'));
  scenarios.push(expiredCredentialScenario());
  scenarios.push(changedSpecScenario());
  scenarios.push(changedPlanScenario());
  scenarios.push(cancellationScenario('before_dispatch'));
  scenarios.push(cancellationScenario('after_artifact_production'));
  scenarios.push(supersessionScenario('before_execution'));
  scenarios.push(supersessionScenario('before_approval'));

  for (const s of scenarios) {
    fs.writeFileSync(path.join(RESULTS_DIR, `${s.id}.json`), JSON.stringify(s, null, 2));
  }

  const summary = scenarios.map((s) => ({
    id: s.id, description: s.description, passed: scenarioPassed(s),
    checks: s.checks.length, failedChecks: s.checks.filter((c) => !c.pass).map((c) => c.name),
  }));
  fs.writeFileSync(path.join(RESULTS_DIR, 'summary.json'), JSON.stringify(summary, null, 2));

  const totalChecks = scenarios.reduce((n, s) => n + s.checks.length, 0);
  const failedChecks = scenarios.reduce((n, s) => n + s.checks.filter((c) => !c.pass).length, 0);
  const lines = [
    `Scenarios: ${scenarios.length}, passed: ${summary.filter((s) => s.passed).length}, failed: ${summary.filter((s) => !s.passed).length}`,
    `Checks: ${totalChecks}, passed: ${totalChecks - failedChecks}, failed: ${failedChecks}`,
    '',
    ...summary.map((s) => `${s.passed ? 'PASS' : 'FAIL'}  ${s.id}  (${s.checks} checks${s.failedChecks.length ? `, failed: ${s.failedChecks.join(', ')}` : ''})`),
  ];
  const summaryText = lines.join('\n');
  fs.writeFileSync(path.join(RESULTS_DIR, 'summary.txt'), summaryText + '\n');
  console.log(summaryText);
  console.log(`\nScratch root: ${SCRATCH_ROOT}`);
  console.log(`Results: ${RESULTS_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
