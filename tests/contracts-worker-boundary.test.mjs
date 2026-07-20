/**
 * Verifies contract enforcement at the Worker Profile assignment boundary.
 *
 * Invalid input packets block before provider invocation, invalid output
 * packets preserve paid model output while recording violations, and
 * assignments without packet fields remain unchecked.
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
const CONTRACT_ID = 'product-manager-to-architect';
const VALID_PACKET = {
  problem: 'The release workflow is unreliable.',
  functionalRequirements: ['Produce a deterministic release plan.'],
  nonFunctionalRequirements: ['Preserve auditability.'],
  acceptanceCriteria: ['The plan passes contract validation.'],
  constraints: ['Use canonical registry concepts.'],
  valueStatement: 'Reliable releases reduce operational risk.',
  tradeoffTable: [{ option: 'deterministic', tradeoff: 'less flexibility' }],
  prioritizationCall: 'Ship deterministic validation first.',
};
const fetchOk = (text = 'specialist output') => async () => ({ ok: true, json: async () => ({ content: [{ type: 'text', text }] }) });

test.beforeEach(() => _resetPackRegistryCache());

function readViolations(cwd) {
  const file = violationLogPath(cwd);
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

test('invalid input packet blocks execution with CONTRACT_VIOLATION_INPUT and never calls the provider', async () => {
  const cwd = tempDir('cx-worker-boundary-input-', test);
  let providerCalled = false;
  const task = {
    workerProfileId: 'architect',
    inputContractId: CONTRACT_ID,
    packet: { problem: VALID_PACKET.problem },
  };
  const run = { request: { summary: 'review the change' } };

  await assert.rejects(
    () => runTaskViaProvider({
      task, run, model: MODEL, provider: 'anthropic', env: ENV, cwd,
      fetchImpl: async () => { providerCalled = true; return { ok: true, json: async () => ({ content: [] }) }; },
    }),
    (err) => err.code === 'CONTRACT_VIOLATION_INPUT'
      && new RegExp(CONTRACT_ID).test(err.message)
      && /functionalRequirements/.test(err.message),
  );
  assert.equal(providerCalled, false, 'an invalid input packet must block the provider call entirely');

  const violations = readViolations(cwd);
  assert.equal(violations.length, 1);
  assert.equal(violations[0].contractId, CONTRACT_ID);
  assert.equal(violations[0].direction, 'input');
  assert.ok(violations[0].missing.includes('functionalRequirements'));
});

test('a conforming input packet passes validation and reaches the provider', async () => {
  const cwd = tempDir('cx-worker-boundary-input-ok-', test);
  const task = {
    workerProfileId: 'architect',
    inputContractId: CONTRACT_ID,
    packet: { ...VALID_PACKET },
  };
  const run = { request: { summary: 'review the change' } };
  const result = await runTaskViaProvider({ task, run, model: MODEL, provider: 'anthropic', env: ENV, cwd, fetchImpl: fetchOk() });
  assert.equal(result.output, 'specialist output');
  assert.equal(readViolations(cwd).length, 0);
});

test('validateInputPacket skips validation when the assignment carries no packet', () => {
  const result = validateInputPacket({ workerProfileId: 'architect' }, { cwd: tempDir('cx-worker-boundary-skip-', test) });
  assert.equal(result.checked, false);
});

test('validateInputPacket skips validation when a Worker Profile has ambiguous incoming contracts', () => {
  const result = validateInputPacket({ workerProfileId: 'architect', packet: { anything: true } }, { cwd: tempDir('cx-worker-boundary-ambiguous-', test) });
  assert.equal(result.checked, false);
});

test('resolveOutputContractId resolves the canonical contract for a producing Worker Profile', () => {
  const run = { tasks: [
    { id: 't1', seq: 0, workerProfileId: 'product-manager', status: 'done' },
    { id: 't2', seq: 1, workerProfileId: 'architect', status: 'awaiting-host' },
  ] };
  assert.equal(resolveOutputContractId(run.tasks[0], run), CONTRACT_ID);
});

test('resolveInputContractId disambiguates by the previous dispatched assignment Worker Profile', () => {
  const run = { tasks: [
    { id: 't1', seq: 0, workerProfileId: 'product-manager', status: 'done' },
    { id: 't2', seq: 1, workerProfileId: 'architect', status: 'awaiting-host' },
  ] };
  assert.equal(resolveInputContractId(run.tasks[1], run), CONTRACT_ID);
});

test('adjacent-assignment disambiguation returns null when no canonical producer matches', () => {
  const run = { tasks: [
    { id: 't1', seq: 0, workerProfileId: 'engineer', status: 'done' },
    { id: 't2', seq: 1, workerProfileId: 'architect', status: 'awaiting-host' },
  ] };
  assert.equal(resolveInputContractId(run.tasks[1], run), null);
});

test('resolveOutputContractId without a run uses canonical Worker Profile and explicit assignment metadata', () => {
  assert.equal(resolveOutputContractId({ workerProfileId: 'architect' }), null);
  assert.equal(resolveOutputContractId({ workerProfileId: 'product-manager' }), CONTRACT_ID);
  assert.equal(resolveOutputContractId({ workerProfileId: 'architect', outputContractId: CONTRACT_ID }), CONTRACT_ID);
});

test('validateInputPacket honors an explicit inputContractId override', () => {
  const cwd = tempDir('cx-worker-boundary-explicit-', test);
  assert.throws(
    () => validateInputPacket({
      workerProfileId: 'architect',
      inputContractId: CONTRACT_ID,
      packet: { problem: VALID_PACKET.problem },
    }, { cwd }),
    (err) => err.code === 'CONTRACT_VIOLATION_INPUT' && new RegExp(CONTRACT_ID).test(err.message),
  );
  assert.equal(readViolations(cwd).length, 1);
});

test('invalid output packet marks the result blocked-contract, logs, and preserves real model output', async () => {
  const cwd = tempDir('cx-worker-boundary-output-', test);
  const task = {
    workerProfileId: 'product-manager',
    outputContractId: CONTRACT_ID,
    outputPacket: { problem: VALID_PACKET.problem },
  };
  const run = { request: { summary: 'implement the change' } };
  const result = await runTaskViaProvider({ task, run, model: MODEL, provider: 'anthropic', env: ENV, cwd, fetchImpl: fetchOk('real model output') });

  assert.equal(result.output, 'real model output', 'blocked output is still real model output, not discarded');
  assert.equal(result.contractStatus, 'blocked-contract');
  assert.equal(result.contractId, CONTRACT_ID);
  assert.ok(Array.isArray(result.contractViolations) && result.contractViolations.length > 0);

  const violations = readViolations(cwd);
  assert.equal(violations.length, 1);
  assert.equal(violations[0].contractId, CONTRACT_ID);
  assert.equal(violations[0].direction, 'output');
  assert.equal(violations[0].verdict, 'BLOCKED_CONTRACT');
});

test('a conforming output packet marks the result contractStatus ok and logs nothing', async () => {
  const cwd = tempDir('cx-worker-boundary-output-ok-', test);
  const task = {
    workerProfileId: 'product-manager',
    outputContractId: CONTRACT_ID,
    outputPacket: { ...VALID_PACKET },
  };
  const run = { request: { summary: 'implement the change' } };
  const result = await runTaskViaProvider({ task, run, model: MODEL, provider: 'anthropic', env: ENV, cwd, fetchImpl: fetchOk() });

  assert.equal(result.contractStatus, 'ok');
  assert.equal(result.contractId, CONTRACT_ID);
  assert.equal(result.contractViolations, undefined);
  assert.equal(readViolations(cwd).length, 0);
});

test('validateOutputPacket skips validation when the assignment carries no outputPacket', () => {
  const result = validateOutputPacket({ workerProfileId: 'product-manager', outputContractId: CONTRACT_ID }, { cwd: tempDir('cx-worker-boundary-output-skip-', test) });
  assert.equal(result.checked, false);
  assert.equal(result.contractStatus, 'unchecked');
});

test('runTaskViaProvider result always carries contractStatus, defaulting to unchecked on an unopted-in assignment', async () => {
  const cwd = tempDir('cx-worker-boundary-default-', test);
  const task = { workerProfileId: 'engineer', reason: 'implement the change' };
  const run = { request: { summary: 'refactor the auth module' } };
  const result = await runTaskViaProvider({ task, run, model: MODEL, provider: 'anthropic', env: ENV, cwd, fetchImpl: fetchOk() });
  assert.equal(result.contractStatus, 'unchecked');
  assert.equal(readViolations(cwd).length, 0);
});

test('a bare assignment with no packet fields does not throw, log, or replace real output', async () => {
  const cwd = tempDir('cx-worker-boundary-parity-', test);
  const task = { workerProfileId: 'engineer', reason: 'implement the change', outputContractId: null };
  const run = { request: { summary: 'refactor the auth module' } };
  const result = await runTaskViaProvider({ task, run, model: MODEL, provider: 'anthropic', env: ENV, cwd, fetchImpl: fetchOk('engineer result') });
  assert.equal(result.output, 'engineer result');
  assert.equal(result.provider, 'anthropic');
  assert.equal(readViolations(cwd).length, 0);
});

test('two canonical assignments auto-populate packets, resolve the contract, and record violations without degrading', async () => {
  const cwd = tempDir('cx-worker-boundary-e2e-', test);
  const run = { runId: 'run-e2e-1', request: { summary: 'draft and assess a release PRD' }, tasks: [] };
  const productManagerAssignment = { id: 't1', seq: 0, workerProfileId: 'product-manager', reason: 'draft the PRD', outputContractId: null };
  const architectAssignment = { id: 't2', seq: 1, workerProfileId: 'architect', reason: 'assess the PRD', outputContractId: null };
  run.tasks.push(productManagerAssignment, architectAssignment);

  const productManagerResult = await runTaskViaProvider({
    task: productManagerAssignment, run, model: MODEL, provider: 'anthropic', env: ENV, cwd,
    fetchImpl: fetchOk('Drafted a release workflow PRD with acceptance criteria.'),
  });
  productManagerAssignment.output = productManagerResult.output;
  productManagerAssignment.status = 'done';

  assert.deepEqual(productManagerAssignment.outputPacket, { content: productManagerResult.output });
  assert.equal(productManagerResult.contractId, CONTRACT_ID);
  assert.equal(productManagerResult.contractStatus, 'ok');
  assert.ok(Array.isArray(productManagerResult.contractViolations) && productManagerResult.contractViolations.length > 0);
  const afterProducer = readViolations(cwd);
  assert.equal(afterProducer.length, 1);
  assert.equal(afterProducer[0].contractId, CONTRACT_ID);
  assert.equal(afterProducer[0].direction, 'output');
  assert.equal(afterProducer[0].runId, 'run-e2e-1');

  const architectResult = await runTaskViaProvider({
    task: architectAssignment, run, model: MODEL, provider: 'anthropic', env: ENV, cwd,
    fetchImpl: fetchOk('Assessed the PRD and documented architectural tradeoffs.'),
  });

  assert.deepEqual(architectAssignment.packet, { fromWorkerProfileId: 'product-manager', content: productManagerResult.output });
  assert.equal(architectResult.output, 'Assessed the PRD and documented architectural tradeoffs.', 'real, already-paid-for output is never discarded by a contract violation');

  const allViolations = readViolations(cwd);
  assert.ok(allViolations.length >= 2, 'both the output-side and input-side violations are real, observable log entries');
  assert.ok(allViolations.some((v) => v.direction === 'input' && v.contractId === CONTRACT_ID));
});
