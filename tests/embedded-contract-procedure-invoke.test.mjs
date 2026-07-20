/**
 * embedded-contract-procedure-invoke.test.mjs — canonical Construct contract coverage.
 *
 * Assertions pin the clean-slate public model and reject retired terminology.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { invokeProcedure } from '../lib/embedded-contract/procedure-invoke.mjs';
import { isLifecycleState } from '../lib/artifact-lifecycle.mjs';

test('unknown Procedure returns a canonical error', async () => {
  const result = await invokeProcedure({ procedureId: 'unknown' }, { env: {} });
  assert.equal(result.status, 'error');
  assert.equal(result.errors[0].code, 'UNKNOWN_PROCEDURE');
  assert.match(result.procedureRunId, /^procedure-/);
  assert.ok(!('workflowId' in result));
  assert.equal(result.lifecycle, undefined);
});

test('Procedure invocation selects Worker Profiles without retired fields', async () => {
  const result = await invokeProcedure({ procedureId: 'prd-draft', approvalMode: 'proposal-only', recruitment: 'off' }, { env: {} });
  assert.equal(result.status, 'proposed');
  assert.equal(result.procedureId, 'prd-draft');
  assert.deepEqual(result.selectedWorkerProfiles, ['product-manager', 'architect']);
  assert.equal(result.workerProfileStrategy, 'auto');
  for (const retired of ['workflowType', 'selectedRoles', 'roleStrategy']) assert.ok(!(retired in result));
});

test('Procedure invocation attaches plan-only lifecycle handoff', async () => {
  const result = await invokeProcedure({ procedureId: 'prd-draft', approvalMode: 'proposal-only', recruitment: 'off' }, { env: {} });
  assert.ok(result.lifecycle && typeof result.lifecycle === 'object');
  assert.equal(result.lifecycle.state, 'planned');
  assert.ok(isLifecycleState(result.lifecycle.state));
  assert.equal(typeof result.lifecycle.nextAction, 'string');
  assert.ok(result.lifecycle.nextAction.length > 0);
  assert.match(result.lifecycle.nextAction, /plan only/i);
  assert.equal(result.lifecycle.evidence.procedureId, 'prd-draft');
  assert.equal(result.lifecycle.evidence.procedureStatus, 'proposed');
});

test('explicit Worker Profile selection filters unknown records', async () => {
  const result = await invokeProcedure({
    procedureId: 'prd-draft',
    workerProfileStrategy: 'explicit',
    requestedWorkerProfiles: ['architect', 'unknown'],
    approvalMode: 'proposal-only',
    recruitment: 'off',
  }, { env: {} });
  assert.deepEqual(result.selectedWorkerProfiles, ['architect']);
  assert.ok(result.warnings.some((warning) => warning.includes('Unknown Worker Profile')));
});
