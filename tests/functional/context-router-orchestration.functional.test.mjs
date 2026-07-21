/**
 * tests/functional/context-router-orchestration.functional.test.mjs — construct-72gqn.23 (D3).
 *
 * Before this bead, an orchestration run's specialist prompts got no per-role
 * artifact routing: buildContextPacket (lib/context-router.mjs) shaped role-aware
 * packets for the skills MCP surface alone, never for a dispatched specialist.
 * Both real runtime backends are exercised end to end (provider — a scripted
 * model call per task; host — prompts materialized for the calling host): a run
 * carrying a caller candidate snapshot renders a per-role,
 * trust-wrapped `## Role context` section into each specialist's prompt, strictly
 * honors the role policy's avoid list (role-boundary compliance), drops a skill
 * the role is not entitled to, and renders nothing when no candidates were given.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { runOrchestration } from '../../lib/orchestration/runtime.mjs';

const MODEL = 'anthropic/claude-sonnet-4-6';
const ENV = { CONSTRUCT_MODEL_REASONING: MODEL, CONSTRUCT_MODEL_STANDARD: MODEL, CONSTRUCT_MODEL_FAST: MODEL };

const dirs = [];
function project() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-d3-context-'));
  dirs.push(cwd);
  return cwd;
}
test.after(() => { for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} } });

// runOrchestration resolves the run store through the machine-scoped state root
// (ADR-0066), which reads CONSTRUCT_HOME_OVERRIDE from real process.env directly.

const homeOverride = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-d3-context-home-'));
const prevHomeOverride = process.env.CONSTRUCT_HOME_OVERRIDE;
process.env.CONSTRUCT_HOME_OVERRIDE = homeOverride;
test.after(() => {
  try { fs.rmSync(homeOverride, { recursive: true, force: true }); } catch {}
  if (prevHomeOverride === undefined) delete process.env.CONSTRUCT_HOME_OVERRIDE;
  else process.env.CONSTRUCT_HOME_OVERRIDE = prevHomeOverride;
});

const REQUEST = 'refactor the auth module and review for security';

// The candidate kinds are chosen to differentiate the base orchestrated chain
// [architect, engineer, reviewer, qa]: architect PREFERS adr and AVOIDS
// user-signal, so the architect prompt (seq 0, the first task dispatched) is a
// crisp boundary probe. The skill id is entitled to no real specialist, so it
// must be dropped for every role.
const ADR_MARKER = 'ADR_MARKER_d3af17';
const USERSIGNAL_MARKER = 'USERSIGNAL_MARKER_d3af17';
const TARGETFILE_MARKER = 'TARGETFILE_MARKER_d3af17';
const SKILL_MARKER = 'SKILL_MARKER_d3af17';

const CANDIDATES = [
  { path: 'docs/decisions/adr/0001-tokens.md', kind: 'adr', title: 'ADR: token strategy', summary: ADR_MARKER },
  { path: 'signals/nps-q3.md', kind: 'user-signal', title: 'NPS verbatims', summary: USERSIGNAL_MARKER },
  { path: 'lib/auth.mjs', kind: 'target-file', title: 'auth module', summary: TARGETFILE_MARKER },
  { path: 'skills/unentitled', kind: 'skill', skillId: 'nonexistent/unentitled-skill', title: 'unentitled skill', summary: SKILL_MARKER },
];

test('provider backend: per-role context reaches prompts, honors the avoid list, and drops an unentitled skill', async () => {
  const cwd = project();
  const capturedBodies = [];
  let calls = 0;
  const fetchImpl = async (_url, opts) => {
    calls += 1;
    capturedBodies.push(JSON.parse(opts.body));
    return { ok: true, json: async () => ({ content: [{ type: 'text', text: `specialist-output-${calls}` }] }) };
  };
  const run = await runOrchestration(
    { request: REQUEST, requestedStrategy: 'orchestrated', hostModel: MODEL, fileCount: 4, moduleCount: 2, candidates: CANDIDATES },
    { env: { ...ENV, ANTHROPIC_API_KEY: 'sk-test' }, cwd, workerBackend: 'provider', fetchImpl },
  );
  assert.equal(run.status, 'completed');
  assert.ok(run.tasks.length >= 2, 'the base orchestrated chain must dispatch at least architect + a downstream task');
  assert.ok(run.contextCandidates && run.contextCandidates.length === 4, 'the run persists the sanitized candidate snapshot');

  // Task 1 (architect, seq 0) is the first specialist dispatched. Its policy
  // prefers `adr` and avoids `user-signal`, so its prompt must carry the ADR
  // artifact, trust-wrapped as untrusted context, and must NOT carry the
  // user-signal artifact — the role-boundary the avoid list enforces.
  const architect = capturedBodies[0].messages[0].content[0].text;
  assert.match(architect, /## Role context/, 'the architect prompt carries a role-context section');
  assert.match(architect, /\[UNTRUSTED:external-unauthenticated:context:architect:/, 'the section is trust-wrapped as untrusted context');
  assert.ok(architect.includes(ADR_MARKER), 'the architect (prefers adr) receives the adr artifact');
  assert.ok(!architect.includes(USERSIGNAL_MARKER), 'the architect (avoids user-signal) never receives the user-signal artifact');

  // The unentitled skill is dropped for every role in the chain — a strict
  // entitlement gate, not a budget or ranking side effect.
  for (let i = 0; i < capturedBodies.length; i++) {
    const text = capturedBodies[i].messages[0].content[0].text;
    assert.ok(!text.includes(SKILL_MARKER), `task ${i + 1}'s prompt must not carry the unentitled skill`);
  }

  // The target-file artifact reaches at least one specialist that prefers it
  // (engineer/reviewer/qa) — proving non-skill artifacts route by role.
  const anyHasTargetFile = capturedBodies.some((b) => b.messages[0].content[0].text.includes(TARGETFILE_MARKER));
  assert.ok(anyHasTargetFile, 'at least one specialist that prefers target-file receives it');
});

test('host backend: the materialized host prompt carries the same per-role, entitlement-filtered context', async () => {
  const cwd = project();
  const run = await runOrchestration(
    { request: REQUEST, requestedStrategy: 'orchestrated', hostModel: MODEL, host: 'OpenCode', fileCount: 4, moduleCount: 2, candidates: CANDIDATES },
    { env: ENV, cwd, workerBackend: 'host' },
  );
  assert.ok(run.tasks.length >= 2);

  const architect = run.tasks[0].hostPrompt.user;
  assert.match(architect, /## Role context/, 'the host-materialized architect prompt carries a role-context section');
  assert.match(architect, /\[UNTRUSTED:external-unauthenticated:context:architect:/);
  assert.ok(architect.includes(ADR_MARKER), 'the architect receives the adr artifact on the host backend too');
  assert.ok(!architect.includes(USERSIGNAL_MARKER), 'the avoid list holds on the host backend');
  for (const t of run.tasks) {
    assert.ok(!t.hostPrompt.user.includes(SKILL_MARKER), 'the unentitled skill is dropped on the host backend');
  }
});

test('a run with no candidates renders no role-context section (byte-identical to a pre-D3 prompt)', async () => {
  const cwd = project();
  const capturedBodies = [];
  const fetchImpl = async (_url, opts) => {
    capturedBodies.push(JSON.parse(opts.body));
    return { ok: true, json: async () => ({ content: [{ type: 'text', text: 'ok' }] }) };
  };
  const run = await runOrchestration(
    { request: REQUEST, requestedStrategy: 'orchestrated', hostModel: MODEL, fileCount: 4, moduleCount: 2 },
    { env: { ...ENV, ANTHROPIC_API_KEY: 'sk-test' }, cwd, workerBackend: 'provider', fetchImpl },
  );
  assert.equal(run.status, 'completed');
  assert.ok(!('contextCandidates' in run), 'a run given no candidates persists no candidate field');
  for (const b of capturedBodies) {
    assert.doesNotMatch(b.messages[0].content[0].text, /## Role context/, 'no role-context section is rendered without candidates');
  }
});
