/**
 * tests/agent-contracts-enforce-postconditions.test.mjs
 *
 * Pins the wiring of binary postconditions into enforcePacket. Output-direction
 * validation now also evaluates lib/agents/postconditions.mjs rules for the
 * contract's producer, and a failure throws ContractViolationError with
 * verdict='BLOCKED_CONTRACT' so the dispatcher can branch on the typed verdict.
 *
 * The test uses a real contract whose producer is one of the hardened roles
 * (cx-reviewer), so the postcondition path is genuinely exercised.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { enforcePacket, ContractViolationError } from '../lib/agent-contracts-enforce.mjs';
import { getOutgoingContracts } from '../lib/agent-contracts.mjs';

function findReviewerContract() {
  const out = getOutgoingContracts('cx-reviewer');
  // Pick whichever contract has an output spec; if there is none, fall back to the first.
  return out.find((c) => c.output) || out[0];
}

describe('enforcePacket — binary postconditions on output direction', () => {
  it('skips postconditions for input-direction validation', () => {
    const contract = findReviewerContract();
    if (!contract) return; // no reviewer contract in this build, nothing to assert
    // An input packet is not the producer's output, so the producer's
    // postconditions must not fire here.
    const inputSpec = contract.input;
    const packet = {};
    for (const key of inputSpec?.mustContain || []) packet[key] = 'placeholder';
    // Should not throw on the postconditions side (it may throw on missing input fields,
    // but that's a different reason).
    try {
      enforcePacket(contract.id, packet, 'input');
    } catch (err) {
      assert.notEqual(err.verdict, 'BLOCKED_CONTRACT', 'input direction must not trigger BLOCKED_CONTRACT');
    }
  });

  it('throws BLOCKED_CONTRACT when reviewer output rubber-stamps', () => {
    const contract = findReviewerContract();
    if (!contract) return;
    // Build a packet that satisfies whatever the output spec requires
    // but fails the binary postcondition (empty findings, no explicit clear).
    const packet = {};
    for (const key of contract.output?.mustContain || []) packet[key] = 'placeholder';
    packet.findings = [];
    try {
      enforcePacket(contract.id, packet, 'output');
      assert.fail('expected ContractViolationError');
    } catch (err) {
      assert.ok(err instanceof ContractViolationError);
      assert.equal(err.verdict, 'BLOCKED_CONTRACT');
      assert.ok(err.postconditionFailures.some((f) => f.id === 'reviewer.findings-or-explicit-clear'));
    }
  });

  it('passes when reviewer output names at least one finding', () => {
    const contract = findReviewerContract();
    if (!contract) return;
    const packet = {};
    for (const key of contract.output?.mustContain || []) packet[key] = 'placeholder';
    packet.findings = [{ severity: 'high', summary: 'auth bypass on /login' }];
    const result = enforcePacket(contract.id, packet, 'output');
    assert.equal(result.ok, true);
  });
});
