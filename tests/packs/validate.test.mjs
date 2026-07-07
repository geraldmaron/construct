/**
 * tests/packs/validate.test.mjs — pack manifest validator unit tests.
 *
 * Packs are third-party distributable bundles (id/version/compatVersion per
 * ADR-0055) that can contribute specialists, prompts, tools, and provider
 * capability grants; validating a pack's manifest before it is trusted —
 * rejecting unknown fields, incompatible compatVersion, and embedBindings
 * naming providers/capabilities outside the known-provider allowlist — is
 * supply-chain integrity checking for that ingestion path.
 *
 * @owasp LLM03
 */

import test from 'node:test';
import assert from 'node:assert';
import { validatePackManifest } from '../../lib/packs/validate.mjs';
import { PACK_REQUIRED_FIELDS, PACK_COMPAT_VERSION } from '../../lib/packs/manifest-schema.mjs';

const validManifest = { id: '@org/test-pack', version: '1.0.0', compatVersion: 1 };

const KNOWN_PROVIDERS = {
  'atlassian-jira': { id: 'atlassian-jira', kind: 'data-source', capabilities: ['read', 'search'] },
  slack: { id: 'slack', kind: 'data-source', capabilities: ['read', 'search'] },
};

test('validatePackManifest', async (t) => {
  await t.test('valid manifest returns valid:true', () => {
    const result = validatePackManifest(validManifest);
    assert.deepEqual(result, { valid: true });
  });

  await t.test('missing required fields produce errors', () => {
    for (const field of PACK_REQUIRED_FIELDS) {
      const m = { ...validManifest };
      delete m[field];
      const result = validatePackManifest(m);
      assert.equal(result.valid, false);
      assert.ok(result.errors.some(e => e.includes(`missing required field: ${field}`)),
        `should detect missing ${field}`);
    }
  });

  await t.test('invalid id format rejected', () => {
    const result = validatePackManifest({ ...validManifest, id: 'UPPERCASE' });
    assert.equal(result.valid, false);
    assert.ok(result.errors[0].includes('id must match'));
  });

  await t.test('invalid version rejected', () => {
    const result = validatePackManifest({ ...validManifest, version: 'not-semver' });
    assert.equal(result.valid, false);
    assert.ok(result.errors[0].includes('semver'));
  });

  await t.test('compatVersion exceeded rejected', () => {
    const result = validatePackManifest({ ...validManifest, compatVersion: PACK_COMPAT_VERSION + 1 });
    assert.equal(result.valid, false);
    assert.ok(result.errors[0].includes('compatVersion'));
  });

  await t.test('deprecation missing since field', () => {
    const result = validatePackManifest({ ...validManifest, deprecation: { message: 'gone' } });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('since')));
  });

  await t.test('deprecation missing message field', () => {
    const result = validatePackManifest({ ...validManifest, deprecation: { since: '1.0.0' } });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('message')));
  });

  await t.test('valid deprecation passes', () => {
    const result = validatePackManifest({ ...validManifest, deprecation: { since: '1.0.0', message: 'use v2' } });
    assert.equal(result.valid, true);
  });

  await t.test('strict mode rejects unknown fields', () => {
    const result = validatePackManifest(
      { ...validManifest, unknownField: true },
      { strict: true }
    );
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes("unknown field 'unknownField'")));
  });

  await t.test('non-strict mode accepts unknown fields', () => {
    const result = validatePackManifest({ ...validManifest, unknownField: true });
    assert.equal(result.valid, true);
  });

  await t.test('non-object returns error', () => {
    assert.equal(validatePackManifest(null).valid, false);
    assert.equal(validatePackManifest('string').valid, false);
    assert.equal(validatePackManifest([]).valid, false);
  });

  await t.test('filePath appears in errors when provided', () => {
    const result = validatePackManifest({}, { filePath: '/test/pack.manifest.json' });
    assert.equal(result.valid, false);
    assert.ok(result.errors[0].includes('/test/pack.manifest.json'));
  });
});

test('validatePackManifest embedBindings (LMCP-E4)', async (t) => {
  await t.test('valid binding against a known provider+capability passes', () => {
    const result = validatePackManifest({
      ...validManifest,
      embedBindings: {
        'cx-operations': {
          providers: [{ id: 'atlassian-jira', capabilities: ['read'] }],
          proposals: ['atlassian-jira.createIssue'],
        },
      },
    }, { knownProviders: KNOWN_PROVIDERS });
    assert.equal(result.valid, true);
  });

  await t.test('unknown provider id fails with a path', () => {
    const result = validatePackManifest({
      ...validManifest,
      embedBindings: {
        'cx-operations': {
          providers: [{ id: 'nonexistent-provider', capabilities: ['read'] }],
        },
      },
    }, { knownProviders: KNOWN_PROVIDERS });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('embedBindings.cx-operations.providers[0].id') && e.includes('nonexistent-provider')));
  });

  await t.test('undeclared capability fails with a path', () => {
    const result = validatePackManifest({
      ...validManifest,
      embedBindings: {
        'cx-operations': {
          // slack manifest only declares read/search — "write" is not declared.
          providers: [{ id: 'slack', capabilities: ['write'] }],
        },
      },
    }, { knownProviders: KNOWN_PROVIDERS });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('embedBindings.cx-operations.providers[0].capabilities[0]')));
  });

  await t.test('capability not in EMBED_BINDING_CAPABILITIES is rejected', () => {
    const result = validatePackManifest({
      ...validManifest,
      embedBindings: {
        'cx-operations': {
          providers: [{ id: 'slack', capabilities: ['admin'] }],
        },
      },
    }, { knownProviders: KNOWN_PROVIDERS });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('not a recognized embed capability')));
  });

  await t.test('proposal token referencing unknown provider fails', () => {
    const result = validatePackManifest({
      ...validManifest,
      embedBindings: {
        'cx-operations': {
          providers: [{ id: 'slack', capabilities: ['read'] }],
          proposals: ['nonexistent-provider.createIssue'],
        },
      },
    }, { knownProviders: KNOWN_PROVIDERS });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('embedBindings.cx-operations.proposals[0]') && e.includes('unknown provider')));
  });

  await t.test('proposal token malformed (no dot) fails', () => {
    const result = validatePackManifest({
      ...validManifest,
      embedBindings: { 'cx-operations': { proposals: ['createIssue'] } },
    }, { knownProviders: KNOWN_PROVIDERS });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('embedBindings.cx-operations.proposals[0]')));
  });

  await t.test('proposal referencing a provider outside providers[] grant fails', () => {
    const result = validatePackManifest({
      ...validManifest,
      embedBindings: {
        'cx-operations': {
          providers: [{ id: 'slack', capabilities: ['read'] }],
          proposals: ['atlassian-jira.createIssue'],
        },
      },
    }, { knownProviders: KNOWN_PROVIDERS });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('not in this specialist\'s providers[] grant')));
  });

  await t.test('unrecognized embedBindings field name fails with a path', () => {
    const result = validatePackManifest({
      ...validManifest,
      embedBindings: { 'cx-operations': { unknownField: true } },
    }, { knownProviders: KNOWN_PROVIDERS });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('embedBindings.cx-operations.unknownField')));
  });

  await t.test('embedBindings must be an object', () => {
    const result = validatePackManifest({ ...validManifest, embedBindings: ['not-an-object'] }, { knownProviders: KNOWN_PROVIDERS });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('embedBindings must be an object')));
  });
});