/**
 * manifest-schema.test.mjs — canonical Construct contract coverage.
 *
 * Assertions pin the clean-slate public model and reject retired terminology.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PROCEDURE_TYPES, PROCEDURE_REQUIRED_FIELDS, PROCEDURE_OPTIONAL_FIELDS,
  PROCEDURE_SCHEMA_VERSION, APPROVAL_MODES, MODEL_TIERS, PROCEDURE_STATES,
} from '../../lib/procedures/manifest-schema.mjs';

test('Procedure schema exposes only canonical record fields', () => {
  for (const field of ['id', 'version', 'type', 'workerProfiles', 'approvalMode', 'modelTier', 'state']) {
    assert.ok(PROCEDURE_REQUIRED_FIELDS.includes(field));
  }
  for (const retired of ['roleChain', 'defaultApprovalMode', 'tier', 'compatVersion']) {
    assert.ok(!PROCEDURE_REQUIRED_FIELDS.includes(retired));
    assert.ok(!PROCEDURE_OPTIONAL_FIELDS.includes(retired));
  }
  assert.deepEqual(MODEL_TIERS, ['cheap', 'standard', 'strong']);
  assert.deepEqual(PROCEDURE_STATES, ['defined', 'active', 'retired', 'removed']);
  assert.ok(PROCEDURE_TYPES.includes('linear'));
  assert.ok(APPROVAL_MODES.includes('proposal-only'));
  assert.equal(PROCEDURE_SCHEMA_VERSION, 1);
});
