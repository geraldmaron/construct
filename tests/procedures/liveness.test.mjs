/**
 * liveness.test.mjs — canonical Construct contract coverage.
 *
 * Assertions pin the clean-slate public model and reject retired terminology.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { checkProcedureLiveness } from '../../lib/procedures/liveness.mjs';
import { loadAllProcedures } from '../../lib/procedures/loader.mjs';

const procedure = (overrides = {}) => ({ id: 'sample', type: 'linear', workerProfiles: ['architect'], surfaces: ['cli'], modes: ['solo'], ...overrides });

test('unknown Worker Profile is rejected', () => {
  const { violations } = checkProcedureLiveness([procedure({ workerProfiles: ['not-installed'] })]);
  assert.ok(violations.some((entry) => entry.includes("Worker Profile 'not-installed' is not installed")));
});

test('repeated Worker Profile is rejected as an Assignment cycle', () => {
  const { violations } = checkProcedureLiveness([procedure({ workerProfiles: ['architect', 'security', 'architect'] })]);
  assert.ok(violations.some((entry) => entry.includes('workerProfiles repeats')));
});

test('unreachable Procedure is rejected', () => {
  const { violations } = checkProcedureLiveness([procedure({ surfaces: [] })]);
  assert.ok(violations.some((entry) => entry.includes("Procedure 'sample' is unreachable")));
});

test('all canonical built-ins are live', () => {
  const { procedures, errors } = loadAllProcedures();
  assert.deepEqual(errors, []);
  assert.deepEqual(checkProcedureLiveness(procedures).violations, []);
});
