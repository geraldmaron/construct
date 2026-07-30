/**
 * tests/functional/standing-assignments.functional.test.mjs
 *
 * Drives the Standing Assignment model end to end in isolated
 * tmpdir projects: a record persists durably and is readable by the real
 * `construct embed assignments` CLI in a separate process; an enabled embed
 * capability materializes as a `capability:<id>` assignment whose scheduled
 * tick flows through the real Scheduler + registerEmbedCapabilityJobs path;
 * the P0-4 lifecycle invariant holds — due-detection, listing, and status
 * reads never advance `lastAttemptAt`, only an execution attempt does
 * (including an executor that throws); and a `source-change` trigger
 * is driven by real upstream drift against a local
 * bare git remote through lib/sources/watch.mjs's actual detection, with
 * only `runAssignmentAttempt` able to consume that drift.
 */

import assert from 'node:assert/strict';
import { execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { after } from 'node:test';
import { rmTmpDir } from '../helpers/cleanup.mjs';

import { readWatchState, refreshWatch } from '../../lib/sources/watch.mjs';

import {
  assignmentStatus,
  attemptStatusFromTick,
  capabilityAssignmentId,
  isAssignmentDue,
  listAssignments,
  parseIntervalMs,
  readAssignment,
  readAssignmentState,
  runAssignmentAttempt,
  syncCapabilityAssignments,
  validateAssignment,
  writeAssignment,
} from '../../lib/embed/standing-assignments.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.resolve(__dirname, '..', '..', 'bin', 'construct');

// refreshWatch/readWatchState persist watch state via resolveStatePath
// (lib/state-root.mjs), which anchors to the real user home unless
// CONSTRUCT_HOME_OVERRIDE is set — an unpinned run leaks a fresh
// ~/.construct/projects/<hash>/context-repos/ key per tmpdir project root.

const HOME_OVERRIDE = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-standing-assign-home-'));
const PREV_HOME_OVERRIDE = process.env.CONSTRUCT_HOME_OVERRIDE;
process.env.CONSTRUCT_HOME_OVERRIDE = HOME_OVERRIDE;
after(() => {
  if (PREV_HOME_OVERRIDE === undefined) delete process.env.CONSTRUCT_HOME_OVERRIDE;
  else process.env.CONSTRUCT_HOME_OVERRIDE = PREV_HOME_OVERRIDE;
  fs.rmSync(HOME_OVERRIDE, { recursive: true, force: true });
});

const tmpDirs = [];
function freshCwd() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-standing-assign-fn-'));
  fs.mkdirSync(path.join(dir, '.construct'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.construct', 'context.md'), '# test project\n');
  tmpDirs.push(dir);
  return dir;
}
after(() => {
  for (const dir of tmpDirs) {
    try { rmTmpDir(dir); } catch { /* tmpdir cleanup only */ }
  }
});

function gitIn(dir, args) {
  return execSync(`git -C "${dir}" ${args}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

// A local bare remote plus a working clone gives lib/sources/watch.mjs a real
// `git ls-remote` upstream: `commit` pushes a new HEAD and returns its sha.

function gitFixture() {
  const remote = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-sa-remote-'));
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-sa-work-'));
  tmpDirs.push(remote, work);
  gitIn(remote, 'init --bare -b main');
  gitIn(work, 'init -b main');
  gitIn(work, 'config user.email test@example.com');
  gitIn(work, 'config user.name test');
  gitIn(work, `remote add origin "${remote}"`);
  const commit = (message, contents) => {
    fs.writeFileSync(path.join(work, 'file.txt'), contents);
    gitIn(work, 'add -A');
    gitIn(work, `commit -m "${message}"`);
    gitIn(work, 'push -u origin main');
    return gitIn(work, 'rev-parse HEAD').trim();
  };
  const head = commit('first', 'one');
  return { remote, work, head, commit };
}

function corpusTarget(remote, id = 'git-1') {
  return { id, provider: 'git', selector: { remote, content: { mode: 'corpus', ref: 'main' } } };
}

function sourceChangeAssignment(id, targetId, lifecycle = 'active') {
  return {
    id,
    title: `Watch ${targetId}`,
    origin: 'manual',
    lifecycle,
    trigger: { kind: 'source-change', targetId },
    action: { kind: 'capability-tick', capabilityId: 'operations' },
  };
}

function validAssignment(id = 'capability:operations') {
  return {
    id,
    title: 'Embed capability: operations',
    origin: 'embed-capability',
    lifecycle: 'active',
    trigger: { kind: 'interval', every: 'PT15M' },
    action: { kind: 'capability-tick', capabilityId: 'operations' },
  };
}

function validCapabilityManifest(id = 'operations') {
  return {
    id,
    type: 'embed',
    version: '1.0.0',
    defaultApprovalMode: 'proposal-only',
    embed: {
      specialist: 'cx-operations',
      providerBindings: ['github', 'jira'],
      framework: 'cx-ops-triage',
      outputContract: 'proposal.v1',
      proposalAuthority: 'propose-only',
      cadence: { every: 'PT15M' },
      runtime: 'auto',
    },
  };
}

function writeProjectManifest(cwd, id, manifest) {
  const dir = path.join(cwd, '.construct', 'embed');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${id}.manifest.json`), JSON.stringify(manifest));
}

function runCli(args, cwd) {
  return spawnSync('node', [BIN, 'embed', ...args], { cwd, encoding: 'utf8', timeout: 30_000 });
}

function statePathFor(cwd, id) {
  return path.join(cwd, '.construct', 'runtime', 'standing-assignments', `${encodeURIComponent(id)}.state.json`);
}

function definitionPathFor(cwd, id) {
  return path.join(cwd, '.construct', 'runtime', 'standing-assignments', `${encodeURIComponent(id)}.assignment.json`);
}

async function waitFor(predicate, { timeoutMs = 5_000, stepMs = 50 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, stepMs));
  }
  return predicate();
}

test('writeAssignment fails closed on an invalid record and writes nothing', () => {
  const cwd = freshCwd();

  const bad = validAssignment('bad-one');
  bad.trigger = { kind: 'cron', every: '* * * * *' };
  const result = writeAssignment(bad, { rootDir: cwd });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.startsWith('trigger.kind:')), `field-path error present — got: ${result.errors}`);
  assert.equal(fs.existsSync(definitionPathFor(cwd, 'bad-one')), false, 'invalid record must not be written');

  const check = validateAssignment({ id: 'x', origin: 'manual', lifecycle: 'active', trigger: { kind: 'interval', every: 'bogus' }, action: { kind: 'capability-tick', capabilityId: 'y' } });
  assert.equal(check.valid, false);
  assert.ok(check.errors.some((e) => e.startsWith('trigger.every:')));
});

test('a Standing Assignment persists durably and the real CLI reads it from a separate process', () => {
  const cwd = freshCwd();

  const written = writeAssignment(validAssignment(), { rootDir: cwd });
  assert.equal(written.ok, true, `write ok — errors: ${written.errors}`);
  assert.ok(fs.existsSync(written.filePath), 'definition file exists on disk');

  const onDisk = JSON.parse(fs.readFileSync(written.filePath, 'utf8'));
  assert.equal(onDisk.id, 'capability:operations');
  assert.equal(onDisk.version, 1);
  assert.ok(onDisk.createdAt && onDisk.updatedAt);

  const listRes = runCli(['assignments', '--json'], cwd);
  assert.equal(listRes.status, 0, `assignments list exit 0 — stderr: ${listRes.stderr}`);
  const listed = JSON.parse(listRes.stdout);
  assert.equal(listed.assignments.length, 1);
  assert.equal(listed.assignments[0].id, 'capability:operations');
  assert.equal(listed.assignments[0].lifecycle, 'active');
  assert.equal(listed.assignments[0].due, true, 'never-attempted active interval assignment is due');
  assert.equal(listed.assignments[0].lastAttemptAt, null);
  assert.deepEqual(listed.errors, []);

  const statusRes = runCli(['assignments', 'status', 'capability:operations', '--json'], cwd);
  assert.equal(statusRes.status, 0, `assignments status exit 0 — stderr: ${statusRes.stderr}`);
  const status = JSON.parse(statusRes.stdout);
  assert.equal(status.ok, true);
  assert.equal(status.assignment.id, 'capability:operations');
  assert.equal(status.state, null, 'no attempt state before any execution attempt');
  assert.equal(status.due, true);

  const missingRes = runCli(['assignments', 'status', 'capability:nope', '--json'], cwd);
  assert.equal(missingRes.status, 1, 'unknown assignment id exits non-zero');
});

test('due-detection, listing, and status reads never advance last-attempt state; only an execution attempt does', async () => {
  const cwd = freshCwd();
  const written = writeAssignment(validAssignment(), { rootDir: cwd });
  assert.equal(written.ok, true);
  const assignment = written.assignment;
  const statePath = statePathFor(cwd, assignment.id);

  for (let i = 0; i < 3; i += 1) {
    assert.equal(isAssignmentDue(assignment, { state: readAssignmentState(assignment.id, { rootDir: cwd }) }), true);
    listAssignments({ rootDir: cwd });
    assignmentStatus(assignment.id, { rootDir: cwd });
    runCli(['assignments', '--json'], cwd);
  }
  assert.equal(fs.existsSync(statePath), false, 'repeated due-detection and reads must not create attempt state');

  const attempt = await runAssignmentAttempt(assignment, async () => ({ status: 'ran' }), { rootDir: cwd });
  assert.equal(attempt.attempted, true);
  assert.equal(attempt.status, 'ran');
  assert.ok(fs.existsSync(statePath), 'attempt state exists only after an execution attempt');

  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  assert.equal(state.assignmentId, assignment.id);
  assert.equal(state.lastAttemptStatus, 'ran');
  assert.equal(state.attemptCount, 1);
  assert.equal(isAssignmentDue(assignment, { state }), false, 'freshly-attempted assignment is not due within its interval');
  assert.equal(isAssignmentDue(assignment, { state, now: Date.parse(state.lastAttemptAt) + parseIntervalMs('PT15M') + 1 }), true, 'due again after the interval elapses');
});

test('an executor that throws still counts as an execution attempt and is recorded as error', async () => {
  const cwd = freshCwd();
  const written = writeAssignment(validAssignment(), { rootDir: cwd });
  const attempt = await runAssignmentAttempt(written.assignment, async () => {
    throw new Error('executor exploded');
  }, { rootDir: cwd });

  assert.equal(attempt.attempted, true);
  assert.equal(attempt.status, 'error');
  assert.equal(attempt.detail, 'executor exploded');

  const state = readAssignmentState(written.assignment.id, { rootDir: cwd });
  assert.equal(state.lastAttemptStatus, 'error');
  assert.equal(state.lastAttemptDetail, 'executor exploded');
  assert.equal(state.attemptCount, 1);
});

test('a non-active assignment never invokes the executor and never advances state', async () => {
  const cwd = freshCwd();
  const retired = { ...validAssignment('capability:retired-one'), lifecycle: 'retired' };
  const written = writeAssignment(retired, { rootDir: cwd });
  assert.equal(written.ok, true);

  let invoked = false;
  const attempt = await runAssignmentAttempt(written.assignment, async () => {
    invoked = true;
    return { status: 'ran' };
  }, { rootDir: cwd });

  assert.equal(attempt.attempted, false);
  assert.equal(attempt.reason, 'lifecycle-retired');
  assert.equal(invoked, false, 'executor must not run for a retired assignment');
  assert.equal(fs.existsSync(statePathFor(cwd, retired.id)), false);
  assert.equal(isAssignmentDue(written.assignment, { state: null }), false, 'retired assignments are never due');
});

test('an enabled capability ticks through the Standing Assignment model via the real scheduler path', async () => {
  const cwd = freshCwd();
  writeProjectManifest(cwd, 'operations', validCapabilityManifest('operations'));
  const enableRes = runCli(['enable', 'operations'], cwd);
  assert.equal(enableRes.status, 0, `enable exit 0 — stderr: ${enableRes.stderr}`);
  writeProjectManifest(cwd, 'triage', validCapabilityManifest('triage'));

  const { registerEmbedCapabilityJobs } = await import('../../lib/embed/capability-jobs.mjs');
  const { Scheduler } = await import('../../lib/embed/scheduler.mjs');

  const assignmentId = capabilityAssignmentId('operations');
  const scheduler = new Scheduler();
  try {
    const registered = registerEmbedCapabilityJobs(scheduler, { rootDir: cwd, env: {} });
    assert.deepEqual(registered, ['operations']);
    assert.deepEqual(scheduler.status().map((t) => t.label), ['embed-capability:operations']);

    const materialized = readAssignment(assignmentId, { rootDir: cwd });
    assert.ok(materialized, 'registration materializes the capability assignment record');
    assert.equal(materialized.origin, 'embed-capability');
    assert.equal(materialized.lifecycle, 'active');
    assert.equal(materialized.trigger.kind, 'interval');
    assert.ok(parseIntervalMs(materialized.trigger.every) != null, 'trigger cadence is a valid ISO duration');
    assert.deepEqual(materialized.action, { kind: 'capability-tick', capabilityId: 'operations' });
    assert.equal(readAssignment(capabilityAssignmentId('triage'), { rootDir: cwd }), null, 'a never-enabled capability materializes no assignment');
    assert.equal(fs.existsSync(statePathFor(cwd, assignmentId)), false, 'registration alone (due-detection) must not advance attempt state');

    scheduler.start();
    const attempted = await waitFor(() => fs.existsSync(statePathFor(cwd, assignmentId)));
    assert.equal(attempted, true, 'scheduled tick records an execution attempt');
  } finally {
    scheduler.stop();
  }

  const state = readAssignmentState(assignmentId, { rootDir: cwd });
  assert.equal(state.assignmentId, assignmentId);
  assert.equal(state.lastAttemptStatus, 'skipped', 'no reasoning executor is wired in, so the tick is an honest skip — still an attempt');
  assert.equal(state.attemptCount >= 1, true);

  const tickPath = path.join(cwd, '.construct', 'runtime', 'embed-capabilities', 'operations.json');
  assert.ok(fs.existsSync(tickPath), 'the capability last-tick record still lands alongside the attempt state');
  const tick = JSON.parse(fs.readFileSync(tickPath, 'utf8'));
  assert.equal(tick.status, 'skipped-with-reason');
  assert.equal(attemptStatusFromTick(tick.status), state.lastAttemptStatus);

  const statusRes = runCli(['assignments', 'status', assignmentId, '--json'], cwd);
  assert.equal(statusRes.status, 0, `assignments status exit 0 — stderr: ${statusRes.stderr}`);
  const status = JSON.parse(statusRes.stdout);
  assert.equal(status.ok, true);
  assert.equal(status.state.lastAttemptStatus, 'skipped');
  assert.equal(status.due, false, 'a just-attempted PT15M assignment is not due');
});

test('syncCapabilityAssignments retires an assignment whose capability leaves the enabled set, and re-activates on return', () => {
  const cwd = freshCwd();

  const first = syncCapabilityAssignments({ rootDir: cwd, capabilities: [{ id: 'operations', every: 'PT30M' }] });
  assert.deepEqual(first.errors, []);
  assert.equal(first.synced.length, 1);
  assert.deepEqual(first.retired, []);
  assert.equal(first.synced[0].trigger.every, 'PT30M');

  const second = syncCapabilityAssignments({ rootDir: cwd, capabilities: [] });
  assert.deepEqual(second.errors, []);
  assert.deepEqual(second.retired, [capabilityAssignmentId('operations')]);
  const retired = readAssignment(capabilityAssignmentId('operations'), { rootDir: cwd });
  assert.equal(retired.lifecycle, 'retired');
  assert.equal(isAssignmentDue(retired, { state: null }), false);

  const third = syncCapabilityAssignments({ rootDir: cwd, capabilities: [{ id: 'operations', every: null }] });
  assert.deepEqual(third.errors, []);
  const reactivated = readAssignment(capabilityAssignmentId('operations'), { rootDir: cwd });
  assert.equal(reactivated.lifecycle, 'active');
  assert.equal(reactivated.trigger.every, 'PT15M', 'a capability with no declared cadence gets the default trigger');
  assert.equal(reactivated.createdAt, retired.createdAt, 'createdAt survives the upsert cycle');
});

test('a source-change trigger requires a non-empty targetId and fails closed', () => {
  const cwd = freshCwd();

  const good = sourceChangeAssignment('watch:git-1', 'git-1');
  assert.deepEqual(validateAssignment(good), { valid: true });
  assert.equal(writeAssignment(good, { rootDir: cwd }).ok, true);

  for (const targetId of [undefined, '', 42]) {
    const bad = sourceChangeAssignment('watch:bad', 'git-1');
    bad.trigger = { kind: 'source-change', targetId };
    const result = writeAssignment(bad, { rootDir: cwd });
    assert.equal(result.ok, false, `targetId ${JSON.stringify(targetId)} must be rejected`);
    assert.ok(result.errors.some((e) => e.startsWith('trigger.targetId:')), `field-path error present — got: ${result.errors}`);
    assert.equal(fs.existsSync(definitionPathFor(cwd, 'watch:bad')), false, 'invalid record must not be written');
  }
});

test('a source-change assignment is due on real upstream git drift, and only an execution attempt consumes it', async () => {
  const cwd = freshCwd();
  const { remote, head: headA, commit } = gitFixture();
  const target = corpusTarget(remote);
  const watch = { target, projectRoot: cwd };

  const baseline = refreshWatch(target, { projectRoot: cwd });
  assert.equal(baseline.changed, false);
  assert.equal(baseline.current, headA);

  const written = writeAssignment(sourceChangeAssignment('watch:git-1', 'git-1'), { rootDir: cwd });
  assert.equal(written.ok, true, `write ok — errors: ${written.errors}`);
  const assignment = written.assignment;
  const statePath = statePathFor(cwd, assignment.id);

  assert.equal(isAssignmentDue(assignment, { state: null, watch }), false, 'upstream unchanged since the watch baseline: not due');

  const headB = commit('second', 'two');
  assert.equal(isAssignmentDue(assignment, { state: null, watch }), true, 'upstream commit past the baseline: due');

  for (let i = 0; i < 3; i += 1) {
    assert.equal(isAssignmentDue(assignment, { state: readAssignmentState(assignment.id, { rootDir: cwd }), watch }), true, 'still due on repeated due-checks');
  }
  assert.equal(fs.existsSync(statePath), false, 'due-detection writes no attempt state');
  assert.equal(readWatchState(target, { projectRoot: cwd }).lastSeenHead, headA, 'due-detection never advances the watch cursor');

  assert.equal(isAssignmentDue(assignment, { state: null }), false, 'no watch context: fails closed to not due');
  const mismatched = { ...watch, target: { ...target, id: 'git-2' } };
  assert.equal(isAssignmentDue(assignment, { state: null, watch: mismatched }), false, 'mismatched target id: fails closed to not due');

  const attempt = await runAssignmentAttempt(assignment, async () => ({ status: 'ran' }), { rootDir: cwd, watch });
  assert.equal(attempt.attempted, true);
  assert.equal(attempt.status, 'ran');
  assert.equal(attempt.state.lastConsumedRevision, headB, 'the attempt stamps the upstream revision it consumed');
  const consumedState = readAssignmentState(assignment.id, { rootDir: cwd });
  assert.equal(isAssignmentDue(assignment, { state: consumedState, watch }), false, 'drift consumed by the execution attempt: not due');
  assert.equal(readWatchState(target, { projectRoot: cwd }).lastSeenHead, headA, 'consumption advances the assignment cursor, not the watch cursor');

  const headC = commit('third', 'three');
  assert.equal(isAssignmentDue(assignment, { state: consumedState, watch }), true, 'fresh drift after consumption: due again');

  const blind = await runAssignmentAttempt(assignment, async () => ({ status: 'ran' }), { rootDir: cwd });
  assert.equal(blind.attempted, true);
  assert.equal(blind.state.lastConsumedRevision, headB, 'an attempt without a watch context cannot claim new drift consumed');
  assert.equal(isAssignmentDue(assignment, { state: readAssignmentState(assignment.id, { rootDir: cwd }), watch }), true, 'unproven consumption leaves the assignment due');

  const consuming = await runAssignmentAttempt(assignment, async () => ({ status: 'ran' }), { rootDir: cwd, watch });
  assert.equal(consuming.state.lastConsumedRevision, headC);
  assert.equal(isAssignmentDue(assignment, { state: consuming.state, watch }), false);

  let headD = null;
  const midExecution = await runAssignmentAttempt(assignment, async () => {
    headD = commit('mid-execution', 'four');
    return { status: 'ran' };
  }, { rootDir: cwd, watch });
  assert.equal(midExecution.state.lastConsumedRevision, headC, 'the attempt consumes the revision probed at attempt start, not the mid-execution commit');
  assert.equal(isAssignmentDue(assignment, { state: midExecution.state, watch }), true, 'a commit landing mid-execution stays unconsumed and still due');
  assert.notEqual(headD, null);
});

test('a paused source-change assignment is never due and never attempts, even with real upstream drift', async () => {
  const cwd = freshCwd();
  const { remote, commit } = gitFixture();
  const target = corpusTarget(remote);
  const watch = { target, projectRoot: cwd };

  refreshWatch(target, { projectRoot: cwd });
  commit('drift', 'two');

  const active = writeAssignment(sourceChangeAssignment('watch:active', 'git-1'), { rootDir: cwd }).assignment;
  assert.equal(isAssignmentDue(active, { state: null, watch }), true, 'the drift is real: an active twin on the same target is due');

  const paused = writeAssignment(sourceChangeAssignment('watch:paused', 'git-1', 'paused'), { rootDir: cwd }).assignment;
  assert.equal(isAssignmentDue(paused, { state: null, watch }), false, 'a paused assignment is never due');

  let invoked = false;
  const attempt = await runAssignmentAttempt(paused, async () => {
    invoked = true;
    return { status: 'ran' };
  }, { rootDir: cwd, watch });
  assert.equal(attempt.attempted, false);
  assert.equal(attempt.reason, 'lifecycle-paused');
  assert.equal(invoked, false, 'executor must not run for a paused assignment');
  assert.equal(fs.existsSync(statePathFor(cwd, paused.id)), false);
});
