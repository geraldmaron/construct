/**
 * tests/functional/orchestration-revise-loop.functional.test.mjs — construct-72gqn.30 (D10).
 *
 * Proves the critic/reviser loop end to end on the real provider runtime: when a
 * critic returns actionable changes and reviseLoop is enabled, the runtime
 * re-dispatches the producer (with the critique folded into its prompt) and
 * re-runs the critic, bounded by MAX_REVISION_ROUNDS. Also pins the two things
 * that keep it safe: a default run (no reviseLoop) is byte-identical — no loop
 * tasks — and a critic that approves triggers no revision even with the loop on.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { runOrchestration } from '../../lib/orchestration/runtime.mjs';

const MODEL = 'anthropic/claude-sonnet-4-6';
const ENV = { CX_MODEL_REASONING: MODEL, CX_MODEL_STANDARD: MODEL, CX_MODEL_FAST: MODEL };
const REQUEST = 'build the checkout module end to end and review it';

const dirs = [];
function project() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-revise-loop-'));
  dirs.push(cwd);
  return cwd;
}
test.after(() => { for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} } });

const homeOverride = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-revise-loop-home-'));
const prevHomeOverride = process.env.CX_HOME_OVERRIDE;
process.env.CX_HOME_OVERRIDE = homeOverride;
test.after(() => {
  try { fs.rmSync(homeOverride, { recursive: true, force: true }); } catch {}
  if (prevHomeOverride === undefined) delete process.env.CX_HOME_OVERRIDE;
  else process.env.CX_HOME_OVERRIDE = prevHomeOverride;
});

// The user turn ends with "as the <role> specialist", so the scripted model can
// answer in character: a reviewer always demands changes (to drive the loop to
// its cap), qa approves, and producers return neutral work with no recruit-signal
// keywords so evolving-signal recruitment does not perturb the task count.
function roleAwareFetch(capturedBodies, { reviewerVerdict }) {
  return async (_url, opts) => {
    const body = JSON.parse(opts.body);
    capturedBodies.push(body);
    const user = body.messages[0].content[0].text;
    const role = (user.match(/as the (\S+) specialist/) || [])[1] || '';
    let text;
    if (role === 'reviewer') text = reviewerVerdict === 'approve' ? 'APPROVED. No blocking issues.' : `CHANGES_REQUESTED: this needs rework before it can merge (call ${capturedBodies.length}).`;
    else if (role === 'qa') text = 'APPROVED. Acceptance criteria met.';
    else text = `${role} completed the work (call ${capturedBodies.length}).`;
    return { ok: true, json: async () => ({ content: [{ type: 'text', text }] }) };
  };
}

const loopTasks = (run) => (run.participation || []).filter((p) => p.event === 'joined' && p.via === 'critic-reviser-loop');

test('reviseLoop on: a critic that requests changes drives a bounded reviser→re-critic loop with the critique fed back', async () => {
  const cwd = project();
  const bodies = [];
  const run = await runOrchestration(
    { request: REQUEST, requestedStrategy: 'orchestrated', hostModel: MODEL, fileCount: 5, moduleCount: 2, reviseLoop: true },
    { env: { ...ENV, ANTHROPIC_API_KEY: 'sk-test' }, cwd, workerBackend: 'provider', fetchImpl: roleAwareFetch(bodies, { reviewerVerdict: 'changes' }) },
  );
  assert.equal(run.status, 'completed');
  assert.equal(run.reviseLoop, true);

  // The loop is bounded: at most MAX_REVISION_ROUNDS (2) rounds, each round a
  // reviser + a re-critic, so no more than 4 loop-spawned tasks however many
  // times the critic keeps demanding changes.
  assert.equal(run.revisionRounds, 2, 'the loop stops at MAX_REVISION_ROUNDS');
  const joined = loopTasks(run);
  assert.equal(joined.length, 4, 'two rounds × (reviser + re-critic) = 4 loop tasks');
  assert.ok(joined.some((p) => /revise per/.test(p.reason)), 'a reviser was dispatched');
  assert.ok(joined.some((p) => /re-review/.test(p.reason)), 'the critic re-reviewed');

  // The first reviser's prompt must carry the reviewer's actual critique — the
  // loop only has value if the producer sees what it must fix.
  const reviserBody = bodies.find((b) => {
    const u = b.messages[0].content[0].text;
    return /as the engineer specialist/.test(u) && /## Prior specialist results/.test(u) && /CHANGES_REQUESTED/.test(u);
  });
  assert.ok(reviserBody, "the reviser's prompt folds in the critic's CHANGES_REQUESTED output");
});

test('reviseLoop off (default): no reviser is spawned — the run is byte-identical to pre-D10', async () => {
  const cwd = project();
  const bodies = [];
  const run = await runOrchestration(
    { request: REQUEST, requestedStrategy: 'orchestrated', hostModel: MODEL, fileCount: 5, moduleCount: 2 },
    { env: { ...ENV, ANTHROPIC_API_KEY: 'sk-test' }, cwd, workerBackend: 'provider', fetchImpl: roleAwareFetch(bodies, { reviewerVerdict: 'changes' }) },
  );
  assert.equal(run.status, 'completed');
  assert.equal(run.reviseLoop, undefined, 'a default run carries no reviseLoop field');
  assert.equal(run.revisionRounds, undefined, 'no revision rounds ran');
  assert.equal(loopTasks(run).length, 0, 'no critic-reviser-loop tasks');
});

test('reviseLoop on but the critic approves: no revision is triggered', async () => {
  const cwd = project();
  const bodies = [];
  const run = await runOrchestration(
    { request: REQUEST, requestedStrategy: 'orchestrated', hostModel: MODEL, fileCount: 5, moduleCount: 2, reviseLoop: true },
    { env: { ...ENV, ANTHROPIC_API_KEY: 'sk-test' }, cwd, workerBackend: 'provider', fetchImpl: roleAwareFetch(bodies, { reviewerVerdict: 'approve' }) },
  );
  assert.equal(run.status, 'completed');
  assert.equal(run.reviseLoop, true);
  assert.ok(!run.revisionRounds, 'an approving critic triggers no revision');
  assert.equal(loopTasks(run).length, 0, 'no loop tasks when the critic approves');
});
