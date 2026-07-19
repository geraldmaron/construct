import assert from 'node:assert/strict';
import test from 'node:test';

import { invokeProcedure } from '../lib/embedded-contract/procedure-invoke.mjs';

test('unknown Procedure returns a canonical error', async () => {
  const result = await invokeProcedure({ procedureId: 'unknown' }, { env: {} });
  assert.equal(result.status, 'error');
  assert.equal(result.errors[0].code, 'UNKNOWN_PROCEDURE');
  assert.match(result.procedureRunId, /^procedure-/);
  assert.ok(!('workflowId' in result));
});

test('Procedure invocation selects Worker Profiles without retired fields', async () => {
  const result = await invokeProcedure({ procedureId: 'prd-draft', approvalMode: 'proposal-only', recruitment: 'off' }, { env: {} });
  assert.equal(result.status, 'proposed');
  assert.equal(result.procedureId, 'prd-draft');
  assert.deepEqual(result.selectedWorkerProfiles, ['product-manager', 'architect']);
  assert.equal(result.workerProfileStrategy, 'auto');
  for (const retired of ['workflowType', 'selectedRoles', 'roleStrategy']) assert.ok(!(retired in result));
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
