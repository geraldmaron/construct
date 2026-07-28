/**
 * tests/contracts/enforcement.test.mjs — the contract enforcement ladder's
 * decision logic (construct-uizpv.5).
 *
 * The functional test covers the CLI paths end to end; this file pins the
 * evaluator's edges: level resolution, trigger matching, and the fail-closed
 * behavior that keeps an unreadable rule set from reading as a clean gate.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  ContractEvaluatorUnavailableError,
  DEFAULT_ENFORCEMENT_LEVEL,
  contractApplies,
  evaluateContractGate,
  resolveContractEnforcement,
} from '../../lib/contracts/enforcement.mjs';

const hard = {
  id: 'c-hard',
  trigger: { riskFlags: ['compliance'] },
  enforcementLevel: 'hard',
  approvalWorkerProfiles: ['security'],
};

const soft = {
  id: 'c-soft',
  trigger: { riskFlags: ['privacy'] },
  enforcementLevel: 'soft',
  approvalWorkerProfiles: ['security'],
};

test('an undeclared contract defaults to advisory', () => {
  const resolved = resolveContractEnforcement({ id: 'c' });
  assert.equal(resolved.level, DEFAULT_ENFORCEMENT_LEVEL);
  assert.equal(resolved.declared, false);
  assert.equal(resolved.error, null);
});

test('an unknown enforcementLevel is an error, not a silent downgrade to advisory', () => {
  const resolved = resolveContractEnforcement({ id: 'c', enforcementLevel: 'blocking' });
  assert.equal(resolved.level, null);
  assert.match(resolved.error, /unknown enforcementLevel 'blocking'/);
});

test('a hard contract naming no approver is an error — nothing could clear it', () => {
  const resolved = resolveContractEnforcement({ id: 'c', enforcementLevel: 'hard' });
  assert.match(resolved.error, /names no approvalWorkerProfiles/);
});

test('a trigger naming neither artifactType nor riskFlags never applies', () => {
  assert.equal(contractApplies({ id: 'c', trigger: {} }, { artifactType: 'prd' }), false);
  assert.equal(contractApplies({ id: 'c' }, { artifactType: 'prd' }), false);
});

test('risk flags match on overlap, not on exact set equality', () => {
  assert.equal(contractApplies(hard, { riskFlags: ['compliance', 'privacy'] }), true);
  assert.equal(contractApplies(hard, { riskFlags: ['licensing'] }), false);
});

test('artifactType must match when the trigger names one', () => {
  const scoped = { id: 'c', trigger: { artifactType: 'compliance-memo', riskFlags: ['compliance'] } };
  assert.equal(contractApplies(scoped, { artifactType: 'compliance-memo', riskFlags: ['compliance'] }), true);
  assert.equal(contractApplies(scoped, { artifactType: 'prd', riskFlags: ['compliance'] }), false);
});

test('a hard contract blocks without a sign-off and clears with one', () => {
  const blocked = evaluateContractGate({ contracts: [hard], riskFlags: ['compliance'] });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.blocked[0].level, 'hard');

  const cleared = evaluateContractGate({
    contracts: [hard],
    riskFlags: ['compliance'],
    signOffs: [{ contractId: 'c-hard', workerProfile: 'security', decision: 'approved' }],
  });
  assert.equal(cleared.ok, true);
});

test('a sign-off from a Worker Profile outside approvalWorkerProfiles does not clear', () => {
  const result = evaluateContractGate({
    contracts: [hard],
    riskFlags: ['compliance'],
    signOffs: [{ contractId: 'c-hard', workerProfile: 'architect', decision: 'approved' }],
  });
  assert.equal(result.ok, false);
});

test('an override clears a soft rung but never a hard one', () => {
  const softCleared = evaluateContractGate({
    contracts: [soft],
    riskFlags: ['privacy'],
    overrides: [{ contractId: 'c-soft', reason: 'accepted' }],
  });
  assert.equal(softCleared.ok, true);
  assert.equal(softCleared.overridden[0].reason, 'accepted');

  const hardStillBlocked = evaluateContractGate({
    contracts: [hard],
    riskFlags: ['compliance'],
    overrides: [{ contractId: 'c-hard', reason: 'accepted' }],
  });
  assert.equal(hardStillBlocked.ok, false);
});

test('an advisory contract reports without blocking', () => {
  const result = evaluateContractGate({
    contracts: [{ id: 'c-adv', trigger: { riskFlags: ['compliance'] } }],
    riskFlags: ['compliance'],
  });
  assert.equal(result.ok, true);
  assert.equal(result.advisory.length, 1);
});

test('a contract with an invalid level blocks rather than passing unevaluated', () => {
  const result = evaluateContractGate({
    contracts: [{ id: 'c-bad', trigger: { riskFlags: ['compliance'] }, enforcementLevel: 'nope' }],
    riskFlags: ['compliance'],
  });
  assert.equal(result.ok, false);
  assert.equal(result.errors.length, 1);
});

test('an unloadable contract set throws rather than reporting a clean gate', () => {
  // registry/contracts present but not a directory: readdirSync throws, which
  // must surface as unavailable rather than as an empty (and therefore
  // silently passing) contract set.

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-contract-unreadable-'));
  try {
    fs.mkdirSync(path.join(root, 'registry'), { recursive: true });
    fs.writeFileSync(path.join(root, 'registry', 'contracts'), 'not a directory');
    assert.throws(
      () => evaluateContractGate({ riskFlags: ['compliance'], rootDir: root }),
      ContractEvaluatorUnavailableError,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
