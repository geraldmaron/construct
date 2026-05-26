/**
 * tests/functional/w5-self-loop.functional.test.mjs —
 *
 * Three self-loop closures: daemon safeguard contract, intake daemon
 * end-to-end (drop a file into .cx/inbox/, daemon emits packet within one
 * tick), rule-verifier intent-based approval classification.
 */
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';

import { createDaemon, classifyPacket, readHeartbeat } from '../../lib/daemons/contract.mjs';
import { buildIntakeDaemon, processInboxFile } from '../../lib/intake/daemon.mjs';
import { verifyTranscript, classifyApproval, findConsequentialActions } from '../../lib/hooks/rule-verifier.mjs';

function freshCwd() {
  const cwd = mkdtempSync(join(tmpdir(), 'construct-w5-'));
  return { cwd, cleanup() { try { rmSync(cwd, { recursive: true, force: true }); } catch { /* ignore */ } } };
}

// ── Daemon safeguard contract ───────────────────────────────────────────────

test('daemon refuses to start when killswitch=off', async () => {
  const env = process.env.CONSTRUCT_TEST_KILL;
  process.env.CONSTRUCT_TEST_KILL = 'off';
  try {
    const daemon = createDaemon({
      name: 'kill-test',
      intervalMs: 10,
      killswitchEnv: 'CONSTRUCT_TEST_KILL',
      maxRuntimeMs: 5_000,
      tick: async () => ({ didWork: true }),
    });
    const result = await daemon.run();
    assert.equal(result.stopped, true);
    assert.equal(result.reason, 'killswitch');
  } finally {
    if (env === undefined) delete process.env.CONSTRUCT_TEST_KILL;
    else process.env.CONSTRUCT_TEST_KILL = env;
  }
});

test('daemon shuts down after maxIdleTicks of no work', async () => {
  const daemon = createDaemon({
    name: 'idle-test',
    intervalMs: 5,
    maxIdleTicks: 3,
    maxRuntimeMs: 5_000,
    tick: async () => ({ didWork: false }),
  });
  const result = await daemon.run();
  assert.equal(result.stopped, true);
  assert.equal(result.reason, 'idle');
  assert.ok(result.ticks >= 3);
});

test('daemon respects maxRuntimeMs', async () => {
  const daemon = createDaemon({
    name: 'lifetime-test',
    intervalMs: 5,
    maxIdleTicks: 999,
    maxRuntimeMs: 60,
    tick: async () => ({ didWork: true }),
  });
  const result = await daemon.run();
  assert.equal(result.reason, 'max-runtime');
});

test('daemon writes a heartbeat each tick', async () => {
  const { cwd, cleanup } = freshCwd();
  try {
    const hbPath = join(cwd, 'heartbeat.json');
    const daemon = createDaemon({
      name: 'heartbeat-test',
      intervalMs: 5,
      maxIdleTicks: 2,
      heartbeatPath: hbPath,
      maxRuntimeMs: 5_000,
      tick: async () => ({ didWork: false }),
    });
    await daemon.run();
    const hb = readHeartbeat(hbPath, { staleMs: 60_000 });
    assert.ok(hb, 'expected fresh heartbeat after run');
    assert.equal(hb.name, 'heartbeat-test');
    assert.ok(hb.ticks >= 1);
  } finally { cleanup(); }
});

test('daemon single-writer lock prevents a second instance', async () => {
  const { cwd, cleanup } = freshCwd();
  try {
    const lockPath = join(cwd, 'lock');
    writeFileSync(lockPath, JSON.stringify({ pid: process.pid, startedAt: Date.now() }));
    const daemon = createDaemon({
      name: 'lock-test',
      intervalMs: 5,
      maxIdleTicks: 1,
      lockPath,
      maxRuntimeMs: 5_000,
      tick: async () => ({ didWork: false }),
    });
    const result = await daemon.run();
    assert.equal(result.stopped, true);
    assert.equal(result.reason, 'lock-held');
  } finally { cleanup(); }
});

test('classifyPacket routes past-TTL packets to dead-letter', () => {
  const ancient = { firstSeenAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(), attempts: 0 };
  assert.equal(classifyPacket(ancient, { maxAgeMs: 14 * 24 * 60 * 60 * 1000 }).route, 'dead-letter');
});

test('classifyPacket routes retry-exhausted packets to dead-letter', () => {
  const tired = { firstSeenAt: new Date().toISOString(), attempts: 5 };
  assert.equal(classifyPacket(tired, { maxAttempts: 3 }).route, 'dead-letter');
});

// ── Intake daemon end-to-end ────────────────────────────────────────────────

test('processInboxFile classifies and writes a packet to .cx/intake/pending/', async () => {
  const { cwd, cleanup } = freshCwd();
  try {
    const inbox = join(cwd, '.cx', 'inbox');
    mkdirSync(inbox, { recursive: true });
    const sourceFile = join(inbox, 'sample-bug-report.txt');
    writeFileSync(sourceFile, 'When I press the submit button it does nothing on Safari.');

    const result = await processInboxFile(sourceFile, {
      cwd,
      classify: async () => ({ intakeType: 'bug-report', rdStage: 'triage', primaryOwner: 'debugger', recommendedAction: 'diagnose' }),
    });

    assert.equal(result.didWork, true);
    assert.equal(result.route, 'pending');
    const pendingFiles = readdirSync(join(cwd, '.cx', 'intake', 'pending'));
    const packetFile = pendingFiles.find((f) => f.endsWith('.json'));
    assert.ok(packetFile, 'expected a pending packet file');
    const packet = JSON.parse(readFileSync(join(cwd, '.cx', 'intake', 'pending', packetFile), 'utf8'));
    assert.equal(packet.triage.intakeType, 'bug-report');
  } finally { cleanup(); }
});

test('intake daemon idle-shuts down when inbox is empty', async () => {
  const { cwd, cleanup } = freshCwd();
  try {
    const daemon = buildIntakeDaemon({ cwd, intervalMs: 5 });
    daemon.stop();
    const result = await Promise.race([
      daemon.run(),
      new Promise((r) => setTimeout(() => r({ stopped: true, reason: 'timeout' }), 200)),
    ]);
    assert.ok(['idle', 'requested', 'timeout'].includes(result.reason || ''), `expected idle/requested/timeout, got ${result.reason}`);
  } finally { cleanup(); }
});

// ── Rule verifier ───────────────────────────────────────────────────────────

function userTurn(text) { return { message: { role: 'user', content: text } }; }
function assistantTurn(text) { return { message: { role: 'assistant', content: text } }; }
function bashTurn(command) {
  return { message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash', input: { command } }] } };
}

test('rule-verifier: commit preceded by natural approval ("go ahead and ship it") passes', () => {
  const transcript = [
    assistantTurn('Ready to commit and push the W2 contract enforcement work. Proceed?'),
    userTurn('go ahead and ship it'),
    bashTurn('git commit -m "feat: W2"'),
  ];
  const result = verifyTranscript(transcript);
  assert.equal(result.ok, 'pass', `expected pass; result=${JSON.stringify(result)}`);
});

test('rule-verifier: commit without preceding approval is inconclusive (not auto-fail)', () => {
  const transcript = [
    assistantTurn('Let me think about the next step.'),
    bashTurn('git commit -m "something"'),
  ];
  const result = verifyTranscript(transcript);
  assert.ok(['inconclusive', 'fail'].includes(result.ok), `expected inconclusive or fail; got ${result.ok}`);
});

test('rule-verifier: explicit user refusal short-circuits to fail', () => {
  const transcript = [
    assistantTurn('Should I commit and push now?'),
    userTurn('no, wait — I want to review first'),
    bashTurn('git commit -m "fast move"'),
  ];
  const result = verifyTranscript(transcript);
  assert.equal(result.ok, 'fail');
});

test('rule-verifier detects edits to protected files as consequential', () => {
  const transcript = [
    assistantTurn('I will update CLAUDE.md to reflect the new rule.'),
    { message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Edit', input: { file_path: 'CLAUDE.md' } }] } },
  ];
  const actions = findConsequentialActions(transcript);
  assert.ok(actions.some((a) => a.kind === 'protected' && a.target === 'CLAUDE.md'));
});

test('rule-verifier classifyApproval treats accepting a proposed plan as APPROVED', () => {
  const window = [
    assistantTurn('Here is the plan: commit, push, open PR #80. Want me to proceed?'),
    userTurn('yes, do it'),
  ];
  const verdict = classifyApproval(window, { kind: 'commit', target: 'git commit -m "W3"' });
  assert.equal(verdict, 'APPROVED');
});
