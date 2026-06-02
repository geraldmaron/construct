/**
 * tests/embedded-contract-capability.test.mjs — unit tests for capability discovery.
 *
 * Pins the contract shape and, critically, that the published contract cannot
 * drift from the live registries (roles == registry specialists, workflow types
 * == workflow-defs) and cannot carry credential values (provider entries hold
 * env-key names and a boolean only). Also checks that annotated skills surface
 * structured inputs/artifactType and that the rest are honestly flagged.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { buildCapabilityContract } from '../lib/embedded-contract/capability.mjs';
import { WORKFLOW_TYPES } from '../lib/embedded-contract/workflow-defs.mjs';
import { collectSecretValues, assertNoSecrets } from '../lib/embedded-contract/redaction.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const registry = JSON.parse(readFileSync(join(__dirname, '..', 'specialists', 'registry.json'), 'utf8'));

test('capability contract carries versions and all sections', () => {
  const c = buildCapabilityContract({ env: {} });
  assert.match(c.contractVersion, /^\d+\.\d+\.\d+$/);
  assert.ok(c.constructVersion);
  assert.deepEqual(c.interfaces.map((i) => i.surface).sort(), ['cli', 'mcp', 'sdk']);
  for (const i of c.interfaces) assert.equal(i.contractVersion, c.contractVersion);
  assert.ok(c.roles.length > 0 && c.skills.length > 0 && c.workflows.length > 0);
  assert.ok(c.schemas.length > 0 && c.models.providers.length > 0 && c.policies.length > 0);
});

test('roles do not drift from the registry specialists', () => {
  const c = buildCapabilityContract({ env: {} });
  const contractIds = c.roles.map((r) => r.id).sort();
  const registryIds = registry.specialists.map((s) => s.name).sort();
  assert.deepEqual(contractIds, registryIds);
});

test('workflow types do not drift from workflow-defs', () => {
  const c = buildCapabilityContract({ env: {} });
  assert.deepEqual(c.workflows.map((w) => w.type).sort(), [...WORKFLOW_TYPES].sort());
});

test('provider entries carry env-key names and a boolean — never a value', () => {
  const env = { ANTHROPIC_API_KEY: 'cred-canary-capability-0001' };
  const c = buildCapabilityContract({ env });
  const anthropic = c.models.providers.find((p) => p.id === 'anthropic');
  assert.equal(anthropic.configured, true);
  assert.deepEqual(anthropic.requiresEnv, ['ANTHROPIC_API_KEY']);
  assert.equal(typeof anthropic.configured, 'boolean');
  assert.ok(collectSecretValues(env).has('cred-canary-capability-0001'));
  assert.doesNotThrow(() => assertNoSecrets(c, { env }), 'contract must not contain the credential value');
});

test('every skill surfaces structured inputs/artifactType metadata', () => {
  const c = buildCapabilityContract({ env: {} });
  const review = c.skills.find((s) => s.id === 'quality-gates/review-work');
  assert.ok(review, 'annotated skill present');
  assert.deepEqual(review.inputs, ['change-or-diff', 'acceptance-criteria']);
  assert.equal(review.artifactType, 'review-report');
  const unannotated = c.skills.filter((s) => !Array.isArray(s.inputs) || !s.artifactType);
  assert.equal(unannotated.length, 0, `every skill must carry metadata; missing: ${unannotated.map((s) => s.id).join(', ')}`);
  assert.ok(!c.warnings.some((w) => /skills have no structured/.test(w)), 'no un-annotated-skills warning once coverage is complete');
});

test('telemetry posture reports redaction enabled', () => {
  const c = buildCapabilityContract({ env: {} });
  assert.equal(c.telemetry.redaction, 'enabled');
});
