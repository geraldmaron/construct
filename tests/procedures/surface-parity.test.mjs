/**
 * surface-parity.test.mjs — canonical Construct contract coverage.
 *
 * Assertions pin the clean-slate public model and reject retired terminology.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { actualSurfaces, checkSurfaceParity, DECLARABLE_SURFACES } from '../../lib/procedures/surface-parity.mjs';
import { loadAllProcedures } from '../../lib/procedures/loader.mjs';
import { PROCEDURE_IDS } from '../../lib/embedded-contract/procedure-definitions.mjs';

test('unknown Procedure declaration is not treated as registered', () => {
  const { errors } = checkSurfaceParity([{ id: 'unknown', type: 'linear', surfaces: ['cli'] }]);
  assert.ok(errors.some((error) => error.includes("Procedure 'unknown'")));
});

test('registered Procedure exposes the declarable surfaces', () => {
  assert.deepEqual(actualSurfaces({ id: PROCEDURE_IDS[0], type: 'linear' }), DECLARABLE_SURFACES);
  assert.deepEqual(actualSurfaces({ id: 'operations', type: 'embed' }), []);
});

test('canonical Procedures match their executable surface registration', () => {
  const { procedures, errors: loadErrors } = loadAllProcedures();
  assert.deepEqual(loadErrors, []);
  assert.deepEqual(checkSurfaceParity(procedures).errors, []);
});
