/**
 * tests/functional/standing-assignments.functional.test.mjs
 *
 * Drives the Standing Assignment model (ADR-0085) end to end in isolated
 * tmpdir projects: a record persists durably and is readable by the real
 * `construct embed assignments` CLI in a separate process; an enabled embed
 * capability materializes as a `capability:<id>` assignment whose scheduled
 * tick flows through the real Scheduler + registerEmbedCapabilityJobs path;
 * and the P0-4 lifecycle invariant holds — due-detection, listing, and
 * status reads never advance `lastAttemptAt`, only an execution attempt
 * does (including an executor that throws).
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { after } from 'node:test';
import { rmTmpDir } from '../helpers/cleanup.mjs';

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
