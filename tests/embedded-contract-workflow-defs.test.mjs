/**
 * tests/embedded-contract-workflow-defs.test.mjs — unit tests for workflow definitions.
 *
 * Pins the set of workflow types, that every default chain references real
 * registry role ids (no invented roles), that declared output schemas point at
 * real schema artifacts, and the intake→workflow mapping for the triage bridge.
 */

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { WORKFLOW_TYPES, getWorkflowDef, listWorkflowDefs, workflowTypeForIntake } from '../lib/embedded-contract/workflow-defs.mjs';
import { listRoles } from '../lib/roles/catalog.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_DIR = join(__dirname, '..', 'lib', 'schemas');

test('exposes the six documented workflow types', () => {
  assert.deepEqual(
    [...WORKFLOW_TYPES].sort(),
    ['architecture-review', 'data-structure', 'evidence-ingest', 'memo-draft', 'prd-draft', 'proposal-review', 'research-synthesis', 'risk-review', 'structure-notes', 'transcript-process'],
  );
});

test('every default chain references real registry role ids', () => {
  const known = new Set(listRoles().map((r) => r.id));
  for (const def of listWorkflowDefs()) {
    assert.ok(def.chain.length > 0, `${def.type} has a chain`);
    for (const role of def.chain) {
      assert.ok(known.has(role), `${def.type}: role ${role} exists in the registry`);
    }
  }
});

test('declared output schemas point at real schema artifacts', () => {
  for (const def of listWorkflowDefs()) {
    if (def.outputSchema) {
      assert.ok(existsSync(join(SCHEMA_DIR, `${def.outputSchema}.json`)), `${def.type}: schema ${def.outputSchema}.json exists`);
    }
  }
});

test('each workflow has a valid default approval mode and tier', () => {
  for (const def of listWorkflowDefs()) {
    assert.ok(['proposal-only', 'requires-human-approval', 'allow-durable-write'].includes(def.defaultApprovalMode));
    assert.ok(['reasoning', 'standard', 'fast'].includes(def.tier));
  }
});

test('intake→workflow mapping resolves known types and returns null otherwise', () => {
  assert.equal(workflowTypeForIntake('proposal'), 'proposal-review');
  assert.equal(workflowTypeForIntake('research'), 'research-synthesis');
  assert.equal(workflowTypeForIntake('definitely-not-a-type'), null);
});

test('getWorkflowDef returns null for unknown types', () => {
  assert.equal(getWorkflowDef('nope'), null);
  assert.ok(getWorkflowDef('prd-draft'));
});
