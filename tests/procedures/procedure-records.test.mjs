/**
 * procedure-records.test.mjs — canonical Construct contract coverage.
 *
 * Assertions pin the clean-slate public model and reject retired terminology.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { loadProceduresFromDir, resolveProcedureDirs } from '../../lib/procedures/loader.mjs';
import { APPROVAL_MODES, MODEL_TIERS, PROCEDURE_STATES, PROCEDURE_TYPES } from '../../lib/procedures/manifest-schema.mjs';
import { loadRegistry } from '../../lib/registry/loader.mjs';

test('canonical Procedure records are strict, coherent, and reference Worker Profiles', () => {
  const { manifests, errors } = loadProceduresFromDir(resolveProcedureDirs().builtin, { strict: true });
  assert.deepEqual(errors, []);
  assert.equal(manifests.length, 15);
  const profileIds = new Set(Object.keys(loadRegistry().workerProfiles));
  for (const procedure of manifests) {
    assert.ok(PROCEDURE_TYPES.includes(procedure.type));
    assert.ok(APPROVAL_MODES.includes(procedure.approvalMode));
    assert.ok(MODEL_TIERS.includes(procedure.modelTier));
    assert.ok(PROCEDURE_STATES.includes(procedure.state));
    for (const profileId of procedure.workerProfiles) assert.ok(profileIds.has(profileId), `${procedure.id}: ${profileId}`);
    for (const retired of ['roleChain', 'defaultApprovalMode', 'tier', 'compatVersion']) assert.ok(!(retired in procedure));
  }
});

test('embed Procedures keep their execution payload in the canonical catalog', () => {
  const { manifests } = loadProceduresFromDir(resolveProcedureDirs().builtin, { strict: true });
  const embedded = manifests.filter((procedure) => procedure.type === 'embed');
  assert.equal(embedded.length, 4);
  for (const procedure of embedded) {
    assert.equal(typeof procedure.embed.workerProfileId, 'string');
    assert.ok(procedure.embed.providerBindings.length > 0);
    assert.ok(!('specialist' in procedure.embed));
  }
});
