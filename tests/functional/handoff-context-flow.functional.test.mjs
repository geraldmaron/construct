/**
 * tests/functional/handoff-context-flow.functional.test.mjs — construct-72gqn.10 (H6a).
 *
 * Before this bead, buildUserPrompt (lib/orchestration/worker.mjs) passed a
 * downstream Worker Profile only the contract-id string — no prior Worker Profile's
 * real output ever reached a consumer, on either worker backend. This proves
 * the fix end to end on both backends the real orchestration runtime uses:
 * the provider backend (a real, scripted model call per task) and the host
 * backend (results submitted back via submitHostTaskResult), asserting the
 * downstream Worker Profile's materialized prompt actually contains the upstream
 * Worker Profile's real, trust-wrapped output — not just that the mechanism
 * exists in isolation (tests/orchestration-worker.test.mjs already covers
 * materializeTaskPrompt/buildUserPrompt as pure functions).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { runOrchestration, submitHostTaskResult } from '../../lib/orchestration/runtime.mjs';

const MODEL = 'anthropic/claude-sonnet-4-6';
const ENV = { CONSTRUCT_MODEL_REASONING: MODEL, CONSTRUCT_MODEL_STANDARD: MODEL, CONSTRUCT_MODEL_FAST: MODEL };

const dirs = [];
function project() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-handoff-context-'));
  dirs.push(cwd);
  return cwd;
}
test.after(() => { for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} } });

// runOrchestration/submitHostTaskResult resolve the run store through the
// machine-scoped state root (ADR-0066), which reads CONSTRUCT_HOME_OVERRIDE from
// real process.env directly (same posture as tests/orchestration-runtime.test.mjs).

const homeOverride = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-handoff-context-home-'));
const prevHomeOverride = process.env.CONSTRUCT_HOME_OVERRIDE;
process.env.CONSTRUCT_HOME_OVERRIDE = homeOverride;
test.after(() => {
  try { fs.rmSync(homeOverride, { recursive: true, force: true }); } catch {}
  if (prevHomeOverride === undefined) delete process.env.CONSTRUCT_HOME_OVERRIDE;
  else process.env.CONSTRUCT_HOME_OVERRIDE = prevHomeOverride;
});

const REQUEST = 'refactor the auth module and review for security';
const ARCHITECT_OUTPUT = 'ARCHITECT-DECISION: use short-lived refresh tokens with rotation.';

test('provider backend: a downstream task\'s prompt contains the upstream task\'s real, trust-wrapped output', async () => {
  const cwd = project();
  const capturedBodies = [];
  let calls = 0;
  const fetchImpl = async (_url, opts) => {
    calls += 1;
    capturedBodies.push(JSON.parse(opts.body));
    const text = calls === 1 ? ARCHITECT_OUTPUT : `worker-profile-output-${calls}`;
    return { ok: true, json: async () => ({ content: [{ type: 'text', text }] }) };
  };
  const run = await runOrchestration(
    { request: REQUEST, requestedStrategy: 'orchestrated', hostModel: MODEL, fileCount: 4, moduleCount: 2 },
    { env: { ...ENV, ANTHROPIC_API_KEY: 'sk-test' }, cwd, workerBackend: 'provider', fetchImpl },
  );
  assert.equal(run.status, 'completed');
  assert.ok(run.tasks.length >= 2, 'the base orchestrated Assignment chain must dispatch at least architect + a downstream task');
  assert.ok(capturedBodies.length >= 2);

  // Task 1 (architect, seq 0) is the first Worker Profile dispatched — its own
  // prompt must NOT contain a "Prior Worker Profile results" section (nothing
  // precedes it).
  const firstUserText = capturedBodies[0].messages[0].content[0].text;
  assert.doesNotMatch(firstUserText, /## Prior Worker Profile results/, 'the first-dispatched task has no upstream output to include');

  // Every task dispatched after it must have architect's real output folded
  // into its prompt, trust-wrapped as untrusted data.
  for (let i = 1; i < capturedBodies.length; i++) {
    const userText = capturedBodies[i].messages[0].content[0].text;
    assert.match(userText, /## Prior Worker Profile results/, `task ${i + 1}'s prompt must include the prior-results section`);
    assert.match(userText, /\[UNTRUSTED:team-authored:Worker Profile:architect:/, `task ${i + 1}'s prompt must trust-wrap the architect's output`);
    assert.ok(userText.includes(ARCHITECT_OUTPUT), `task ${i + 1}'s prompt must contain the architect's real output text`);
  }
});

test('host backend: submitHostTaskResult refreshes the next awaiting task\'s materialized prompt with the just-submitted output', async () => {
  const cwd = project();
  const run = await runOrchestration(
    { request: REQUEST, requestedStrategy: 'orchestrated', hostModel: MODEL, host: 'OpenCode', fileCount: 4, moduleCount: 2 },
    { env: ENV, cwd, workerBackend: 'host' },
  );
  assert.ok(run.tasks.length >= 2);

  // Before any result is submitted, the host path materialized every prompt
  // in one pass — the second task's prompt (materialized before task 1 ran)
  // must NOT yet contain task 1's output, since none existed at that point.
  const secondBefore = run.tasks[1].hostPrompt.user;
  assert.doesNotMatch(secondBefore, /## Prior Worker Profile results/, 'a prompt materialized before any upstream task ran must carry no prior-results section');

  const { nextTask } = await submitHostTaskResult(cwd, run.runId, run.tasks[0].id, { output: ARCHITECT_OUTPUT }, { env: ENV });
  assert.equal(nextTask.id, run.tasks[1].id);
  assert.match(nextTask.hostPrompt.user, /## Prior Worker Profile results/, 'the re-materialized next-task prompt must now include the prior-results section');
  // Every submission on this test's host-backend run is host-reported (never
  // provider-verified — that trust level is covered by the provider-backend
  // test above, whose upstream output is real model output Construct itself
  // called for), so the re-materialized prompt wraps it at the lower
  // external-authenticated trust level.
  assert.match(nextTask.hostPrompt.user, /\[UNTRUSTED:external-authenticated:Worker Profile:architect:/);
  assert.ok(nextTask.hostPrompt.user.includes(ARCHITECT_OUTPUT), 'the re-materialized prompt must contain the real submitted output text');
});

test('host backend: a host-reported upstream output is trust-wrapped at the lower external-authenticated level', async () => {
  const cwd = project();
  const run = await runOrchestration(
    { request: REQUEST, requestedStrategy: 'orchestrated', hostModel: MODEL, host: 'OpenCode', fileCount: 4, moduleCount: 2 },
    { env: ENV, cwd, workerBackend: 'host' },
  );
  assert.ok(run.tasks.length >= 3, 'a three-plus task chain is needed to inspect a third task after two host-reported submissions');

  await submitHostTaskResult(cwd, run.runId, run.tasks[0].id, { output: ARCHITECT_OUTPUT }, { env: ENV });
  const { nextTask } = await submitHostTaskResult(cwd, run.runId, run.tasks[1].id, { output: 'ENGINEER-DONE: implemented the change.' }, { env: ENV });

  assert.equal(nextTask.id, run.tasks[2].id);
  // Both prior tasks were host-reported (this test never used the provider
  // backend), so both must carry the lower external-authenticated trust
  // level, never the higher team-authored level a provider-verified task gets.
  assert.match(nextTask.hostPrompt.user, /\[UNTRUSTED:external-authenticated:Worker Profile:architect:/);
  assert.match(nextTask.hostPrompt.user, /\[UNTRUSTED:external-authenticated:Worker Profile:.+:.+\]\nENGINEER-DONE/);
  assert.doesNotMatch(nextTask.hostPrompt.user, /team-authored/, 'no host-reported upstream task may be wrapped at the higher team-authored level');
});
