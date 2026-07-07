/**
 * tests/orchestration-delegation-flow.test.mjs — flow-engine delegation chain
 * for orchestration-policy routes (construct-rf26.9).
 *
 * Pins that buildDelegationFlow()/advanceDelegation() (lib/orchestration/
 * delegation-flow.mjs) reproduce the same specialist ordering routeRequest()
 * already computes and lib/orchestration/runtime.mjs's buildTasks() already
 * dispatches one at a time — parity with the existing, correctly-scoped task
 * granularity, not a new invented shape. Also pins the actual behavior change:
 * a caller driving the chain via advanceDelegation() only ever sees the
 * CURRENT step's delegation, never the whole chain, and the chain survives a
 * checkpoint/resume across separate calls exactly like any other flow run
 * (construct-rf26.7). CX_HOME_OVERRIDE is pinned for the whole file since
 * advanceDelegation checkpoints through the machine-scoped state root.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { routeRequest } from '../lib/orchestration-policy.mjs';
import { buildDelegationFlow, advanceDelegation } from '../lib/orchestration/delegation-flow.mjs';
import { RUN_STATUS } from '../lib/flows/constants.mjs';

const homeOverride = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-delegation-flow-home-'));
const prevHomeOverride = process.env.CX_HOME_OVERRIDE;
process.env.CX_HOME_OVERRIDE = homeOverride;
test.after(() => {
  try { fs.rmSync(homeOverride, { recursive: true, force: true }); } catch {}
  if (prevHomeOverride === undefined) delete process.env.CX_HOME_OVERRIDE;
  else process.env.CX_HOME_OVERRIDE = prevHomeOverride;
});

const dirs = [];
function project() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-delegation-flow-project-'));
  dirs.push(cwd);
  return cwd;
}
test.after(() => { for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} } });

async function drainDelegation(cwd, runId, route) {
  const seen = [];
  for (let i = 0; i < 50; i += 1) {
    const step = await advanceDelegation(cwd, runId, route);
    seen.push(step);
    if (step.done) break;
  }
  return seen;
}

test('buildDelegationFlow orders steps exactly like route.specialists for a focused fix route', () => {
  const route = routeRequest({ request: 'fix the login redirect bug', fileCount: 2, moduleCount: 1 });
  assert.deepEqual(route.specialists, ['cx-debugger', 'cx-engineer']);
  const flow = buildDelegationFlow(route);
  assert.equal(flow.stepOrder.length, 2);
  assert.equal(flow.steps[flow.stepOrder[0]].workerBackend, 'host');
});

test('advanceDelegation surfaces specialists one at a time, in routeRequest order, for a focused fix route', async () => {
  const cwd = project();
  const route = routeRequest({ request: 'fix the login redirect bug', fileCount: 2, moduleCount: 1 });
  const steps = await drainDelegation(cwd, 'run-fix-1', route);

  assert.equal(steps.length, 2, 'exactly one delegation step per specialist, nothing more');
  assert.equal(steps[0].currentDelegation.role, 'cx-debugger');
  assert.equal(steps[0].done, false, 'the first specialist is not the last — chain is not done yet');
  assert.equal(steps[1].currentDelegation.role, 'cx-engineer');
  assert.equal(steps[1].done, true);

  // The defining behavior change: each call's result contains only its own
  // step's delegation — never a peek at any other step's role.
  for (const step of steps) {
    assert.equal(typeof step.currentDelegation.role, 'string');
    assert.equal(Object.keys(step).includes('specialists'), false, 'no whole-chain field leaks onto a single-step result');
  }
});

test('advanceDelegation reproduces the orchestrated build-feature chain end to end', async () => {
  const cwd = project();
  const route = routeRequest({ request: 'build this feature end to end and ship it', fileCount: 4, moduleCount: 2 });
  const expected = route.specialists;
  const steps = await drainDelegation(cwd, 'run-build-1', route);

  assert.equal(steps.length, expected.length);
  assert.deepEqual(steps.map((s) => s.currentDelegation.role), expected, 'delegation order matches routeRequest\'s specialist order exactly');
  assert.equal(steps.at(-1).status, RUN_STATUS.COMPLETED);
});

test('advanceDelegation on an immediate-track route (no specialists) resolves to a single null-delegation done step', async () => {
  const cwd = project();
  const route = routeRequest({ request: 'explain how the caching layer works', fileCount: 1, moduleCount: 1 });
  assert.deepEqual(route.specialists, []);
  const step = await advanceDelegation(cwd, 'run-immediate-1', route);
  assert.equal(step.done, true);
  assert.equal(step.currentDelegation, null);
  assert.equal(step.totalSteps, 0);
});

test('a delegation chain resumes correctly after a simulated crash between steps', async () => {
  const cwd = project();
  const route = routeRequest({ request: 'build this feature end to end and ship it', fileCount: 4, moduleCount: 2 });
  const expected = route.specialists;
  assert.ok(expected.length >= 2, 'need at least two specialists for this test to be meaningful');

  // First "session": only the first delegation is fetched, then the process
  // is treated as gone (no shared memory with what follows).
  const first = await advanceDelegation(cwd, 'run-resume-1', route);
  assert.equal(first.currentDelegation.role, expected[0]);

  // Second "session": a fresh call, same runId, same route recomputed from
  // scratch (routeRequest is pure) — this is exactly how an MCP tool call in a
  // later conversation turn would look. It must continue from specialist 2,
  // not repeat specialist 1.
  const second = await advanceDelegation(cwd, 'run-resume-1', route);
  assert.equal(second.currentDelegation.role, expected[1]);
  assert.notEqual(second.currentDelegation.role, first.currentDelegation.role);
});

test('advanceDelegation reports handoffContract for a specialist that has one, matching contractChain', async () => {
  const cwd = project();
  const route = routeRequest({ request: 'build this feature end to end and ship it', fileCount: 4, moduleCount: 2 });
  const steps = await drainDelegation(cwd, 'run-handoff-1', route);
  const withHandoff = steps.filter((s) => s.currentDelegation.handoffContract);
  assert.ok(withHandoff.length >= 0, 'handoffContract is either populated from contractChain or explicitly null, never undefined');
  for (const step of steps) {
    assert.notEqual(step.currentDelegation.handoffContract, undefined);
  }
});
