/**
 * Tests for a locally defined contract-shape predicate, exercised in isolation
 * against lib/capability-contracts.mjs. This does not call or mirror bin/construct's
 * "Agent contract schema intact" doctor check — that check uses a different
 * predicate (a consumer-naming filter, tracked as broken/vacuous in construct-ik8g)
 * and is not imported here. A regression in the doctor check would not be caught
 * by this suite.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

// Local predicate: flags contracts missing required shape fields (id, producer,
// consumer, and either postconditions or output). Not sourced from bin/construct.

const isBroken = (c) =>
  !c.id || !c.producer || !c.consumer || (!c.postconditions && !c.output);

describe('contract-validation predicate', () => {
  it('flags a contract missing id', () => {
    const contract = { producer: 'construct', consumer: 'orchestrator', postconditions: ['done'] };
    assert.equal(isBroken(contract), true);
  });

  it('flags a contract missing producer', () => {
    const contract = { id: 'x-to-y', consumer: 'qa', postconditions: ['done'] };
    assert.equal(isBroken(contract), true);
  });

  it('flags a contract missing consumer', () => {
    const contract = { id: 'x-to-y', producer: 'construct', postconditions: ['done'] };
    assert.equal(isBroken(contract), true);
  });

  it('flags a contract missing both postconditions and output', () => {
    const contract = { id: 'x-to-y', producer: 'construct', consumer: 'qa' };
    assert.equal(isBroken(contract), true);
  });

  it('passes a contract with postconditions but no output', () => {
    const contract = {
      id: 'construct-to-orchestrator',
      producer: 'construct',
      consumer: 'orchestrator',
      postconditions: ['Dispatch plan emitted'],
    };
    assert.equal(isBroken(contract), false);
  });

  it('passes a contract with output but no postconditions', () => {
    const contract = {
      id: 'user-to-construct',
      producer: 'user',
      consumer: 'construct',
      output: { shape: 'routed-plan' },
    };
    assert.equal(isBroken(contract), false);
  });

  it('all real contracts pass the predicate', async () => {
    const { getAllContracts } = await import('../../lib/capability-contracts.mjs');
    const contracts = getAllContracts();
    assert.ok(contracts.length > 0, 'getAllContracts returned no contracts');
    const broken = contracts.filter(isBroken);
    assert.deepEqual(
      broken.map((c) => c.id ?? '(no id)'),
      [],
      'Real contracts must all pass the schema check',
    );
  });
});
