/**
 * tests/contracts-worker-boundary.test.mjs — LMCP-F2: worker-boundary contract
 * enforcement.
 *
 * Pins three guarantees for lib/orchestration/worker.mjs runTaskViaProvider:
 *   1. An invalid input packet (task.packet) throws CONTRACT_VIOLATION_INPUT
 *      before any provider call — hard fail, blocks execution — and is logged
 *      to .cx/contract-violations.jsonl.
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

import { runTaskViaProvider, validateInputPacket, validateOutputPacket, _resetPackRegistryCache } from '../lib/orchestration/worker.mjs';
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
    role: 'cx-reviewer',
    // cx-reviewer has multiple incoming contracts since construct-rf26.11
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
    role: 'cx-reviewer',
    // See the note in the invalid-packet test above: cx-reviewer now has
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
  const result = validateInputPacket({ role: 'cx-reviewer' }, { cwd: tempDir('cx-worker-boundary-skip-', test) });
  assert.equal(result.checked, false);
});

test('validateInputPacket skips validation when no contract resolves unambiguously (ambiguous role)', () => {
  // cx-engineer has 4 incoming contracts; resolving one automatically without
  // an explicit inputContractId would require guessing among them, so the
  // packet stays unchecked instead of being validated against a guessed contract.
  const result = validateInputPacket({ role: 'cx-engineer', packet: { anything: true } }, { cwd: tempDir('cx-worker-boundary-ambiguous-', test) });
  assert.equal(result.checked, false);
});

test('validateInputPacket honors an explicit inputContractId override', () => {
  const cwd = tempDir('cx-worker-boundary-explicit-', test);
  assert.throws(
    () => validateInputPacket({
      role: 'cx-engineer',
      inputContractId: 'architect-to-engineer',
      packet: { goal: 'g' },
    }, { cwd }),
    (err) => err.code === 'CONTRACT_VIOLATION_INPUT' && /architect-to-engineer/.test(err.message),
  );
  assert.equal(readViolations(cwd).length, 1);
});

// ── Output packet validation (record + mark, never throw) ───────────────────

test('invalid output packet marks the result contract-failed, logs, and preserves real model output', async () => {
  const cwd = tempDir('cx-worker-boundary-output-', test);
  const task = {
    // handoffContract is the producer-side contract id runtime.mjs already
    // resolves (buildTasks); validateOutputPacket trusts it directly rather
    // than re-deriving from role, so task.role need not match the contract's
    // declared producer for this unit-level check. engineer-to-reviewer
    // output requires verdict (enum-constrained) plus findings|noIssuesFoundAt.
    role: 'cx-reviewer',
    handoffContract: 'engineer-to-reviewer',
    outputPacket: { verdict: 'LGTM' },
  };
  const run = { request: { summary: 'implement the change' } };
  const result = await runTaskViaProvider({ task, run, model: MODEL, provider: 'anthropic', env: ENV, cwd, fetchImpl: fetchOk('real model output') });

  assert.equal(result.output, 'real model output', 'contract-failed output is still real model output, not discarded');
  assert.equal(result.contractStatus, 'contract-failed');
  assert.equal(result.contractId, 'engineer-to-reviewer');
  assert.ok(Array.isArray(result.contractViolations) && result.contractViolations.length > 0);

  const violations = readViolations(cwd);
  assert.equal(violations.length, 1);
  assert.equal(violations[0].contractId, 'engineer-to-reviewer');
  assert.equal(violations[0].direction, 'output');
});

test('a conforming output packet marks the result contractStatus ok and logs nothing', async () => {
  const cwd = tempDir('cx-worker-boundary-output-ok-', test);
  const task = {
    role: 'cx-reviewer',
    handoffContract: 'engineer-to-reviewer',
    outputPacket: { verdict: 'APPROVED', findings: ['minor nit'] },
  };
  const run = { request: { summary: 'implement the change' } };
  const result = await runTaskViaProvider({ task, run, model: MODEL, provider: 'anthropic', env: ENV, cwd, fetchImpl: fetchOk() });

  assert.equal(result.contractStatus, 'ok');
  assert.equal(result.contractId, 'engineer-to-reviewer');
  assert.equal(result.contractViolations, undefined);
  assert.equal(readViolations(cwd).length, 0);
});

test('validateOutputPacket skips validation when the task carries no outputPacket (pre-F2 shape)', () => {
  const result = validateOutputPacket({ role: 'cx-reviewer', handoffContract: 'engineer-to-reviewer' }, { cwd: tempDir('cx-worker-boundary-output-skip-', test) });
  assert.equal(result.checked, false);
  assert.equal(result.contractStatus, 'unchecked');
});

test('runTaskViaProvider result always carries contractStatus, defaulting to unchecked on an unopted-in task', async () => {
  const cwd = tempDir('cx-worker-boundary-default-', test);
  const task = { role: 'cx-engineer', reason: 'implement the change' };
  const run = { request: { summary: 'refactor the auth module' } };
  const result = await runTaskViaProvider({ task, run, model: MODEL, provider: 'anthropic', env: ENV, cwd, fetchImpl: fetchOk() });
  assert.equal(result.contractStatus, 'unchecked');
  assert.equal(readViolations(cwd).length, 0);
});

// ── Happy path parity: existing bare-task shape behaves identically ─────────

test('a bare task with no packet fields behaves exactly as pre-F2 (no throw, no log, real output)', async () => {
  const cwd = tempDir('cx-worker-boundary-parity-', test);
  const task = { role: 'cx-engineer', reason: 'implement the change', handoffContract: null };
  const run = { request: { summary: 'refactor the auth module' } };
  const result = await runTaskViaProvider({ task, run, model: MODEL, provider: 'anthropic', env: ENV, cwd, fetchImpl: fetchOk('engineer result') });
  assert.equal(result.output, 'engineer result');
  assert.equal(result.provider, 'anthropic');
  assert.equal(readViolations(cwd).length, 0);
});
