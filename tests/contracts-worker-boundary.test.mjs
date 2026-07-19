/**
 * tests/contracts-worker-boundary.test.mjs — LMCP-F2: worker-boundary contract
 * enforcement.
 *
 * Pins three guarantees for lib/orchestration/worker.mjs runTaskViaProvider:
 *   1. An invalid input packet (task.packet) throws CONTRACT_VIOLATION_INPUT
 *      before any provider call — hard fail, blocks execution — and is logged
 *      to .construct/contract-violations.jsonl.
 *   2. An invalid output packet (task.outputPacket) never throws; the result
 *      carries contractStatus:'contract-failed' plus contractViolations, and
 *      the violation is logged, while the real model output still rides the
 *      result.
 *   3. A task with no packet/outputPacket at all (the pre-F2 shape every
 *      existing caller uses) is never validated — the happy path is
 *      unchanged.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { runTaskViaProvider, validateInputPacket, validateOutputPacket, resolveInputContractId, resolveOutputContractId, _resetPackRegistryCache } from '../lib/orchestration/worker.mjs';
import { violationLogPath } from '../lib/contracts/violation-log.mjs';
import { tempDir } from './helpers.mjs';

const MODEL = 'anthropic/claude-sonnet-4-6';
const ENV = { ANTHROPIC_API_KEY: 'sk-test' };
const fetchOk = (text = 'specialist output') => async () => ({ ok: true, json: async () => ({ content: [{ type: 'text', text }] }) });

test.beforeEach(() => _resetPackRegistryCache());

function readViolations(cwd) {
  const file = violationLogPath(cwd);
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

// ── Input packet validation (hard fail, before invoke) ──────────────────────

test('invalid input packet blocks execution with CONTRACT_VIOLATION_INPUT and never calls the provider', async () => {
  const cwd = tempDir('cx-worker-boundary-input-', test);
  let providerCalled = false;
  const task = {
    role: 'reviewer',
    // reviewer has multiple incoming contracts since construct-rf26.11
    // folded devil-advocate/evaluator/trace-reviewer into it, so an explicit
    // inputContractId is required to disambiguate (see the ambiguous-role
    // test below). engineer-to-reviewer input requires filesChanged,
    // verificationChecklist, feasibilityAssessment, effortClass, debtNote,
    // blastRadius — this packet is missing all but filesChanged.
    inputContractId: 'engineer-to-reviewer',
    packet: { filesChanged: ['lib/foo.mjs'] },
  };
  const run = { request: { summary: 'review the change' } };

  await assert.rejects(
    () => runTaskViaProvider({
      task, run, model: MODEL, provider: 'anthropic', env: ENV, cwd,
      fetchImpl: async () => { providerCalled = true; return { ok: true, json: async () => ({ content: [] }) }; },
    }),
    (err) => err.code === 'CONTRACT_VIOLATION_INPUT'
      && /engineer-to-reviewer/.test(err.message)
      && /verificationChecklist/.test(err.message),
  );
  assert.equal(providerCalled, false, 'an invalid input packet must block the provider call entirely');

  const violations = readViolations(cwd);
  assert.equal(violations.length, 1);
  assert.equal(violations[0].contractId, 'engineer-to-reviewer');
  assert.equal(violations[0].direction, 'input');
  assert.ok(violations[0].missing.includes('verificationChecklist'));
});

test('a conforming input packet passes validation and reaches the provider', async () => {
  const cwd = tempDir('cx-worker-boundary-input-ok-', test);
  const task = {
    role: 'reviewer',
    // See the note in the invalid-packet test above: reviewer now has
    // multiple incoming contracts post-construct-rf26.11, so this must be explicit.
    inputContractId: 'engineer-to-reviewer',
    packet: {
      filesChanged: ['lib/foo.mjs'],
      verificationChecklist: ['ran tests'],
      feasibilityAssessment: 'feasible',
      effortClass: 'S',
      debtNote: 'none',
      blastRadius: 'low',
    },
  };
  const run = { request: { summary: 'review the change' } };
  const result = await runTaskViaProvider({ task, run, model: MODEL, provider: 'anthropic', env: ENV, cwd, fetchImpl: fetchOk() });
  assert.equal(result.output, 'specialist output');
  assert.equal(readViolations(cwd).length, 0);
});

test('validateInputPacket skips validation when the task carries no packet (pre-F2 shape)', () => {
  const result = validateInputPacket({ role: 'reviewer' }, { cwd: tempDir('cx-worker-boundary-skip-', test) });
  assert.equal(result.checked, false);
});

test('validateInputPacket skips validation when no contract resolves unambiguously (ambiguous role)', () => {
  // engineer has 4 incoming contracts; resolving one automatically without
  // an explicit inputContractId would require guessing among them, so the
  // packet stays unchecked instead of being validated against a guessed contract.
  const result = validateInputPacket({ role: 'engineer', packet: { anything: true } }, { cwd: tempDir('cx-worker-boundary-ambiguous-', test) });
  assert.equal(result.checked, false);
});

// ── Adjacent-task disambiguation (construct-72gqn.11, H6b) ──────────────────
//
// Most roles have several outgoing/incoming contracts post-consolidation, so
// the single-candidate fallback above rarely resolves for the DEFAULT
// orchestrated base chain. When the actual dispatched run.tasks sequence is
// known, the adjacent task's role narrows the candidates by producer/consumer
// match — still returns null (never guesses) when that narrowing still
// leaves more than one candidate.

test('resolveOutputContractId disambiguates by the next dispatched task\'s role when the bare role is ambiguous', () => {
  // architect alone has 15 outgoing contracts (ambiguous), but exactly one
  // has consumer security: architect-to-security.
  const run = { tasks: [
    { id: 't1', seq: 0, role: 'architect', status: 'done' },
    { id: 't2', seq: 1, role: 'security', status: 'awaiting-host' },
  ] };
  assert.equal(resolveOutputContractId(run.tasks[0], run), 'architect-to-security');
});

test('resolveInputContractId disambiguates by the previous dispatched task\'s role when the bare role is ambiguous', () => {
  const run = { tasks: [
    { id: 't1', seq: 0, role: 'architect', status: 'done' },
    { id: 't2', seq: 1, role: 'security', status: 'awaiting-host' },
  ] };
  assert.equal(resolveInputContractId(run.tasks[1], run), 'architect-to-security');
});

test('adjacent-task disambiguation still returns null (never guesses) when several candidates share the same consumer', () => {
  // architect -> engineer is still ambiguous even narrowed by consumer
  // role: architect-to-engineer-ai, architect-to-engineer-data,
  // architect-to-engineer, and architect-to-engineer-platform (a real,
  // pre-existing 29-role-era contract-corpus gap — construct-72gqn epic D1
  // reconciles it; this bead's job is correct plumbing, not guessing).
  const run = { tasks: [
    { id: 't1', seq: 0, role: 'architect', status: 'done' },
    { id: 't2', seq: 1, role: 'engineer', status: 'awaiting-host' },
  ] };
  assert.equal(resolveOutputContractId(run.tasks[0], run), null);
});

test('resolveOutputContractId without a run argument behaves exactly as before disambiguation existed', () => {
  // lib/orchestration/build-audit-record.mjs calls resolveOutputContractId(task)
  // with no run — must keep working unchanged.
  assert.equal(resolveOutputContractId({ role: 'architect' }), null);
  assert.equal(resolveOutputContractId({ role: 'architect', handoffContract: 'architect-to-engineer' }), 'architect-to-engineer');
});

test('validateInputPacket honors an explicit inputContractId override', () => {
  const cwd = tempDir('cx-worker-boundary-explicit-', test);
  assert.throws(
    () => validateInputPacket({
      role: 'engineer',
      inputContractId: 'architect-to-engineer',
      packet: { goal: 'g' },
    }, { cwd }),
    (err) => err.code === 'CONTRACT_VIOLATION_INPUT' && /architect-to-engineer/.test(err.message),
  );
  assert.equal(readViolations(cwd).length, 1);
});

// ── Output packet validation (record + mark, never throw) ───────────────────

test('invalid output packet marks the result blocked-contract, logs, and preserves real model output', async () => {
  const cwd = tempDir('cx-worker-boundary-output-', test);
  const task = {
    // handoffContract is the producer-side contract id runtime.mjs already
    // resolves (buildTasks); the in-run handoff check (construct-pteo2.14)
    // trusts it directly rather than re-deriving from role, so task.role need
    // not match the contract's declared producer for this unit-level check.
    // engineer-to-reviewer output requires verdict (enum-constrained) plus
    // findings|noIssuesFoundAt.
    role: 'reviewer',
    handoffContract: 'engineer-to-reviewer',
    outputPacket: { verdict: 'LGTM' },
  };
  const run = { request: { summary: 'implement the change' } };
  const result = await runTaskViaProvider({ task, run, model: MODEL, provider: 'anthropic', env: ENV, cwd, fetchImpl: fetchOk('real model output') });

  assert.equal(result.output, 'real model output', 'blocked output is still real model output, not discarded');
  assert.equal(result.contractStatus, 'blocked-contract');
  assert.equal(result.contractId, 'engineer-to-reviewer');
  assert.ok(Array.isArray(result.contractViolations) && result.contractViolations.length > 0);

  const violations = readViolations(cwd);
  assert.equal(violations.length, 1);
  assert.equal(violations[0].contractId, 'engineer-to-reviewer');
  assert.equal(violations[0].direction, 'output');
  assert.equal(violations[0].verdict, 'BLOCKED_CONTRACT');
});

test('a conforming output packet marks the result contractStatus ok and logs nothing', async () => {
  const cwd = tempDir('cx-worker-boundary-output-ok-', test);
  const task = {
    role: 'reviewer',
    handoffContract: 'engineer-to-reviewer',
    // The in-run check is the full both-ends validateHandoff pass
    // (construct-pteo2.14), so a conforming packet carries the consumer-side
    // input fields as well as the producer-side output fields.
    outputPacket: {
      verdict: 'APPROVED',
      findings: ['minor nit'],
      filesChanged: ['lib/auth.mjs'],
      verificationChecklist: { testsRun: true, lintClean: true, typesClean: true },
      feasibilityAssessment: 'fits current architecture',
      effortClass: 'S',
      debtNote: 'none',
      blastRadius: 'narrow',
    },
  };
  const run = { request: { summary: 'implement the change' } };
  const result = await runTaskViaProvider({ task, run, model: MODEL, provider: 'anthropic', env: ENV, cwd, fetchImpl: fetchOk() });

  assert.equal(result.contractStatus, 'ok');
  assert.equal(result.contractId, 'engineer-to-reviewer');
  assert.equal(result.contractViolations, undefined);
  assert.equal(readViolations(cwd).length, 0);
});

test('validateOutputPacket skips validation when the task carries no outputPacket (pre-F2 shape)', () => {
  const result = validateOutputPacket({ role: 'reviewer', handoffContract: 'engineer-to-reviewer' }, { cwd: tempDir('cx-worker-boundary-output-skip-', test) });
  assert.equal(result.checked, false);
  assert.equal(result.contractStatus, 'unchecked');
});

test('runTaskViaProvider result always carries contractStatus, defaulting to unchecked on an unopted-in task', async () => {
  const cwd = tempDir('cx-worker-boundary-default-', test);
  const task = { role: 'engineer', reason: 'implement the change' };
  const run = { request: { summary: 'refactor the auth module' } };
  const result = await runTaskViaProvider({ task, run, model: MODEL, provider: 'anthropic', env: ENV, cwd, fetchImpl: fetchOk() });
  assert.equal(result.contractStatus, 'unchecked');
  assert.equal(readViolations(cwd).length, 0);
});

// ── Happy path parity: existing bare-task shape behaves identically ─────────

test('a bare task with no packet fields behaves exactly as pre-F2 (no throw, no log, real output)', async () => {
  const cwd = tempDir('cx-worker-boundary-parity-', test);
  const task = { role: 'engineer', reason: 'implement the change', handoffContract: null };
  const run = { request: { summary: 'refactor the auth module' } };
  const result = await runTaskViaProvider({ task, run, model: MODEL, provider: 'anthropic', env: ENV, cwd, fetchImpl: fetchOk('engineer result') });
  assert.equal(result.output, 'engineer result');
  assert.equal(result.provider, 'anthropic');
  assert.equal(readViolations(cwd).length, 0);
});

// ── End-to-end auto-population through two real dispatched tasks (H6b) ──────

test('a real two-task run auto-populates packets, disambiguates the contract, and records real observability without degrading', async () => {
  const cwd = tempDir('cx-worker-boundary-e2e-', test);
  const run = { runId: 'run-e2e-1', request: { summary: 'implement and verify a rate limiter' }, tasks: [] };
  const engineerTask = { id: 't1', seq: 0, role: 'engineer', reason: 'implement the change', handoffContract: null };
  const qaTask = { id: 't2', seq: 1, role: 'qa', reason: 'verify the change', handoffContract: null };
  run.tasks.push(engineerTask, qaTask);

  const engineerResult = await runTaskViaProvider({
    task: engineerTask, run, model: MODEL, provider: 'anthropic', env: ENV, cwd,
    fetchImpl: fetchOk('Implemented a token-bucket rate limiter in lib/rate-limiter.mjs.'),
  });
  engineerTask.output = engineerResult.output;
  engineerTask.status = 'done';

  // engineer's output packet auto-populated from real free-text output —
  // engineer-to-qa is the one contract with qa as consumer, so the
  // adjacent-task disambiguation resolves it even though engineer alone
  // has 9 ambiguous outgoing contracts.
  assert.deepEqual(engineerTask.outputPacket, { content: engineerResult.output });
  assert.equal(engineerResult.contractId, 'engineer-to-qa');
  // Free text does not satisfy engineer-to-qa's structured fields, so
  // validateHandoff finds and logs a real violation — but warn mode (an
  // auto-populated packet, not a caller-supplied one) never blocks it:
  // contractStatus stays 'ok' and the real violation rides as
  // contractViolations instead of degrading the run.
  assert.equal(engineerResult.contractStatus, 'ok');
  assert.ok(Array.isArray(engineerResult.contractViolations) && engineerResult.contractViolations.length > 0);
  const afterEngineer = readViolations(cwd);
  assert.equal(afterEngineer.length, 1);
  assert.equal(afterEngineer[0].contractId, 'engineer-to-qa');
  assert.equal(afterEngineer[0].direction, 'output');
  assert.equal(afterEngineer[0].runId, 'run-e2e-1');

  const qaResult = await runTaskViaProvider({
    task: qaTask, run, model: MODEL, provider: 'anthropic', env: ENV, cwd,
    fetchImpl: fetchOk('Ran the new rate-limiter tests; all passed.'),
  });

  // qa's INPUT packet auto-populated from engineer's real output (LMCP-B) —
  // the downstream task's handoff carries the real upstream artifact H6a/H6b
  // exist to prove, not a fabricated one.
  assert.deepEqual(qaTask.packet, { fromRole: 'engineer', content: engineerResult.output });
  assert.equal(qaResult.output, 'Ran the new rate-limiter tests; all passed.', 'real, already-paid-for output is never discarded by a contract violation');

  const allViolations = readViolations(cwd);
  assert.ok(allViolations.length >= 2, 'both the output-side and input-side violations are real, observable log entries');
  assert.ok(allViolations.some((v) => v.direction === 'input' && v.contractId === 'engineer-to-qa'));
});
