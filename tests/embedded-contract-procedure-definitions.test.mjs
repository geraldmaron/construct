import assert from 'node:assert/strict';
import test from 'node:test';

import { getProcedureDefinition, listProcedureDefinitions, PROCEDURE_IDS, procedureIdForIntake } from '../lib/embedded-contract/procedure-definitions.mjs';

test('embedded definitions expose canonical Procedure fields', () => {
  assert.equal(PROCEDURE_IDS.length, 11);
  for (const definition of listProcedureDefinitions()) {
    assert.equal(typeof definition.id, 'string');
    assert.ok(Array.isArray(definition.workerProfiles));
    assert.ok(['cheap', 'standard', 'strong'].includes(definition.modelTier));
    assert.ok(!('type' in definition));
    assert.ok(!('chain' in definition));
    assert.ok(!('defaultApprovalMode' in definition));
  }
});

test('definition lookup is exact and intake mapping is catalog-derived', () => {
  assert.ok(getProcedureDefinition('prd-draft'));
  assert.equal(getProcedureDefinition('unknown'), null);
  assert.equal(procedureIdForIntake('unknown'), null);
});
