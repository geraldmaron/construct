import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { listProcedureDefinitions } from '../../lib/embedded-contract/procedure-definitions.mjs';
import { loadAllProcedures } from '../../lib/procedures/loader.mjs';
import { checkAgainstProcedures, checkSource } from '../../scripts/check-procedure-definitions-drift.mjs';

test('embedded definitions derive from canonical Procedures without drift', () => {
  const source = readFileSync('lib/embedded-contract/procedure-definitions.mjs', 'utf8');
  const { procedures, errors } = loadAllProcedures();
  assert.deepEqual(errors, []);
  assert.deepEqual(checkSource(source), []);
  assert.deepEqual(checkAgainstProcedures(procedures, listProcedureDefinitions()), []);
});
