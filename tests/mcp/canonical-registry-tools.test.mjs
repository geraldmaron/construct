/**
 * canonical-registry-tools.test.mjs — canonical Construct contract coverage.
 *
 * Assertions pin the clean-slate public model and reject retired terminology.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { TOOL_DEFS_SKILLS } from '../../lib/mcp/tool-definitions-skills.mjs';
import {
  getCapability,
  getPolicy,
  getProcedure,
  getWorkerProfile,
  listCapabilities,
  listPolicies,
  listProcedures,
  listWorkerProfiles,
  orchestrationPolicy,
} from '../../lib/mcp/tools/skills.mjs';

const ROOT_DIR = new URL('../..', import.meta.url).pathname;

const CANONICAL_TOOLS = [
  'list_worker_profiles', 'get_worker_profile',
  'list_procedures', 'get_procedure',
  'list_capabilities', 'get_capability',
  'list_policies', 'get_policy',
];

test('MCP registry surface exposes canonical nouns and no retired organization APIs', () => {
  const names = new Set(TOOL_DEFS_SKILLS.map((definition) => definition.name));
  for (const name of CANONICAL_TOOLS) assert.ok(names.has(name), `${name} must be advertised`);
  for (const retired of ['list_teams', 'get_team', 'list_specialists', 'get_specialist', 'agent_contract']) {
    assert.equal(names.has(retired), false, `${retired} must not be advertised`);
  }
});

test('canonical registry list/get tools return assembled registry records', () => {
  const opts = { ROOT_DIR };
  const cases = [
    [listWorkerProfiles, getWorkerProfile, 'workerProfiles'],
    [listProcedures, getProcedure, 'procedures'],
    [listCapabilities, getCapability, 'capabilities'],
    [listPolicies, getPolicy, 'policies'],
  ];

  for (const [list, get, key] of cases) {
    const records = list(opts)[key];
    assert.ok(Array.isArray(records) && records.length > 0, `${key} must be populated`);
    const record = get({ id: records[0].id }, opts);
    assert.equal(record.id, records[0].id);
  }
});

test('canonical registry getters fail explicitly for missing records', () => {
  const result = getWorkerProfile({ id: 'does-not-exist' }, { ROOT_DIR });
  assert.match(result.error, /^Worker profile not found:/);
  assert.ok(Array.isArray(result.available));
});

test('orchestration policy exposes assignments without retired organization fields', async () => {
  const result = await orchestrationPolicy({
    request: 'Review authentication for security issues and test gaps.',
    fileCount: 5,
    moduleCount: 2,
  });
  assert.ok(result.assignments.length > 0);
  assert.ok(result.assignments.every((assignment) => typeof assignment.workerProfileId === 'string'));
  for (const retired of ['specialists', 'policySpecialists', 'displaySpecialists', 'teamRouting', 'contractChain']) {
    assert.equal(retired in result, false, `${retired} must not cross the MCP boundary`);
  }
  assert.equal('specialistSequence' in (result.routePath || {}), false);
  assert.equal('assignmentSequence' in (result.routePath || {}), true);
});
