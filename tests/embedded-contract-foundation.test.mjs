/**
 * tests/embed-foundation.test.mjs — unit tests for the ECL foundation modules.
 *
 * Covers contract-version compatibility, the no-secrets redaction guard, the
 * response envelope shape, and the approval/write-gate truth table. These are
 * the invariants the rest of the embedded contract layer depends on.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { CONTRACT_VERSION, MIN_CLIENT_CONTRACT_VERSION, isClientCompatible } from '../lib/embedded-contract/contract-version.mjs';
import { redact, collectSecretValues, assertNoSecrets } from '../lib/embedded-contract/redaction.mjs';
import { wrapResponse, CONTRACT_SURFACES } from '../lib/embedded-contract/envelope.mjs';
import { APPROVAL_MODES, DEFAULT_APPROVAL_MODE, isValidApprovalMode, newTraceId, resolveWriteGate } from '../lib/embedded-contract/audit.mjs';

test('contract-version: CONTRACT_VERSION is valid semver', () => {
  assert.match(CONTRACT_VERSION, /^\d+\.\d+\.\d+$/);
  assert.match(MIN_CLIENT_CONTRACT_VERSION, /^\d+\.\d+\.\d+$/);
});

test('contract-version: same major older-or-equal minor is compatible; different major is not', () => {
  assert.equal(isClientCompatible('1.0.0', '1.0.0'), true);
  assert.equal(isClientCompatible('1.0.0', '1.2.0'), true);
  assert.equal(isClientCompatible('1.3.0', '1.2.0'), false);
  assert.equal(isClientCompatible('2.0.0', '1.0.0'), false);
  assert.equal(isClientCompatible('garbage', '1.0.0'), false);
});

test('redaction: redact masks secret-looking keys, keeps the rest', () => {
  const out = redact({ apiKey: 'abc', nested: { token: 'xyz', name: 'engineer' }, list: [{ password: 'p' }] });
  assert.equal(out.apiKey, '[redacted]');
  assert.equal(out.nested.token, '[redacted]');
  assert.equal(out.nested.name, 'engineer');
  assert.equal(out.list[0].password, '[redacted]');
});

test('redaction: assertNoSecrets throws when a live env credential leaks into output', () => {
  const env = { TEST_API_KEY: 'super-secret-token-value-1234', PATH: '/usr/bin' };
  const secrets = collectSecretValues(env);
  assert.equal(secrets.has('super-secret-token-value-1234'), true);
  assert.equal(secrets.has('/usr/bin'), false);

  assert.throws(
    () => assertNoSecrets({ selectedModel: 'anthropic/x', leaked: 'using super-secret-token-value-1234 here' }, { env }),
    /Secret value leaked/,
  );
  assert.doesNotThrow(() => assertNoSecrets({ selectedModel: 'anthropic/x', requiresCredential: true }, { env }));
});

test('envelope: wrapResponse stamps version + mode and rejects unknown surfaces', () => {
  const env = { CONSTRUCT_DEPLOYMENT_MODE: 'team' };
  const out = wrapResponse({ data: { ok: true }, surface: 'cli', env, generatedAt: '2026-06-02T00:00:00.000Z' });
  assert.equal(out.contractVersion, CONTRACT_VERSION);
  assert.equal(out.constructVersion.length > 0, true);
  assert.equal(out.deploymentMode, 'team');
  assert.equal(out.surface, 'cli');
  assert.equal(out.generatedAt, '2026-06-02T00:00:00.000Z');
  assert.deepEqual(out.data, { ok: true });
  assert.ok(CONTRACT_SURFACES.includes('mcp'));
  assert.throws(() => wrapResponse({ data: {}, surface: 'rest', env }), /Unknown contract surface/);
});

test('envelope: wrapResponse propagates the redaction guard', () => {
  const env = { TEST_SECRET: 'leak-me-please-0001' };
  assert.throws(
    () => wrapResponse({ data: { note: 'leak-me-please-0001' }, surface: 'sdk', env }),
    /Secret value leaked/,
  );
});

test('audit: approval modes and write-gate truth table', () => {
  assert.deepEqual(APPROVAL_MODES, ['proposal-only', 'requires-human-approval', 'allow-durable-write']);
  assert.equal(DEFAULT_APPROVAL_MODE, 'proposal-only');
  assert.equal(isValidApprovalMode('allow-durable-write'), true);
  assert.equal(isValidApprovalMode('nonsense'), false);

  assert.deepEqual(resolveWriteGate({ approvalMode: 'proposal-only', deploymentMode: 'enterprise' }), {
    approvalMode: 'proposal-only', allowWrites: false, requiresApproval: false, mandatoryAudit: false,
  });
  assert.deepEqual(resolveWriteGate({ approvalMode: 'requires-human-approval', deploymentMode: 'solo' }), {
    approvalMode: 'requires-human-approval', allowWrites: false, requiresApproval: true, mandatoryAudit: false,
  });
  assert.deepEqual(resolveWriteGate({ approvalMode: 'allow-durable-write', deploymentMode: 'solo' }), {
    approvalMode: 'allow-durable-write', allowWrites: true, requiresApproval: false, mandatoryAudit: false,
  });
  assert.deepEqual(resolveWriteGate({ approvalMode: 'allow-durable-write', deploymentMode: 'team' }), {
    approvalMode: 'allow-durable-write', allowWrites: true, requiresApproval: false, mandatoryAudit: true,
  });
  assert.deepEqual(resolveWriteGate({ approvalMode: 'bogus' }), {
    approvalMode: 'proposal-only', allowWrites: false, requiresApproval: false, mandatoryAudit: false,
  });
});

test('audit: newTraceId is unique and prefixed', () => {
  const a = newTraceId();
  const b = newTraceId();
  assert.match(a, /^ecl-/);
  assert.notEqual(a, b);
});
