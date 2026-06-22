/**
 * tests/capability-ledger.test.mjs — validates behavior-first test traceability.
 *
 * @capability test-system.capability-ledger
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { formatCapabilityLedgerAudit, validateCapabilityLedger } from '../lib/capability-ledger.mjs';

test('the committed capability ledger has bidirectional behavior-to-test traceability', () => {
  const result = validateCapabilityLedger();
  assert.equal(result.pass, true, formatCapabilityLedgerAudit(result));
  assert.ok(result.capabilityCount >= 4);
  assert.ok(result.mappedTestCount >= result.capabilityCount);
});

test('release-critical entries reject unit-only coverage', () => {
  const result = validateCapabilityLedger({
    ledger: {
      version: 1,
      capabilities: [{
        id: 'fixture.release-only-unit',
        criticality: 'release',
        outcome: 'A user-visible release behavior succeeds.',
        failureModes: ['the behavior regresses'],
        changePaths: ['lib/example.mjs'],
        fixtures: [],
        assertions: ['an observable user result is produced'],
        tests: [{ path: 'tests/capability-ledger.test.mjs', layer: 'unit' }],
      }],
    },
  });
  assert.equal(result.pass, false);
  assert.ok(result.errors.some((error) => error.includes('needs integration, functional, host-emulation, or visual coverage')));
});
