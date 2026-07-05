/**
 * tests/packs/manifest-schema.test.mjs — pack manifest schema constant tests.
 */

import test from 'node:test';
import assert from 'node:assert';
import {
  PACK_REQUIRED_FIELDS, PACK_OPTIONAL_FIELDS, PACK_COMPAT_VERSION,
  PACK_ID_RE, PACK_SOURCE_TIERS,
  EMBED_BINDING_CAPABILITIES, EMBED_BINDING_FIELDS, EMBED_BINDING_PROVIDER_FIELDS,
  EMBED_BINDING_PROPOSAL_RE,
} from '../../lib/packs/manifest-schema.mjs';

test('PACK_REQUIRED_FIELDS', async (t) => {
  await t.test('includes id, version, compatVersion', () => {
    assert.ok(Array.isArray(PACK_REQUIRED_FIELDS));
    assert.ok(PACK_REQUIRED_FIELDS.includes('id'));
    assert.ok(PACK_REQUIRED_FIELDS.includes('version'));
    assert.ok(PACK_REQUIRED_FIELDS.includes('compatVersion'));
  });
});

test('PACK_OPTIONAL_FIELDS', async (t) => {
  await t.test('exports a non-empty array', () => {
    assert.ok(Array.isArray(PACK_OPTIONAL_FIELDS));
    assert.ok(PACK_OPTIONAL_FIELDS.length > 0);
  });

  await t.test('includes teams, specialists, prompts, deprecation', () => {
    assert.ok(PACK_OPTIONAL_FIELDS.includes('teams'));
    assert.ok(PACK_OPTIONAL_FIELDS.includes('specialists'));
    assert.ok(PACK_OPTIONAL_FIELDS.includes('prompts'));
    assert.ok(PACK_OPTIONAL_FIELDS.includes('deprecation'));
  });

  await t.test('includes embedBindings (LMCP-E4)', () => {
    assert.ok(PACK_OPTIONAL_FIELDS.includes('embedBindings'));
  });
});

test('EMBED_BINDING_CAPABILITIES', async (t) => {
  await t.test('is read/search only', () => {
    assert.deepEqual(EMBED_BINDING_CAPABILITIES, ['read', 'search']);
  });
});

test('EMBED_BINDING_FIELDS', async (t) => {
  await t.test('includes providers and proposals', () => {
    assert.ok(EMBED_BINDING_FIELDS.includes('providers'));
    assert.ok(EMBED_BINDING_FIELDS.includes('proposals'));
  });
});

test('EMBED_BINDING_PROVIDER_FIELDS', async (t) => {
  await t.test('includes id, capabilities, filters', () => {
    assert.ok(EMBED_BINDING_PROVIDER_FIELDS.includes('id'));
    assert.ok(EMBED_BINDING_PROVIDER_FIELDS.includes('capabilities'));
    assert.ok(EMBED_BINDING_PROVIDER_FIELDS.includes('filters'));
  });
});

test('EMBED_BINDING_PROPOSAL_RE', async (t) => {
  await t.test('matches providerId.writeKind tokens', () => {
    assert.ok(EMBED_BINDING_PROPOSAL_RE.test('jira.createIssue'));
    assert.ok(EMBED_BINDING_PROPOSAL_RE.test('atlassian-jira.createIssue'));
  });

  await t.test('rejects tokens without a dot', () => {
    assert.ok(!EMBED_BINDING_PROPOSAL_RE.test('createIssue'));
  });
});

test('PACK_COMPAT_VERSION', async (t) => {
  await t.test('is a number', () => {
    assert.equal(typeof PACK_COMPAT_VERSION, 'number');
    assert.ok(PACK_COMPAT_VERSION >= 1);
  });
});

test('PACK_ID_RE', async (t) => {
  await t.test('matches valid pack ids', () => {
    assert.ok(PACK_ID_RE.test('@construct/core'));
    assert.ok(PACK_ID_RE.test('my-org/my-pack'));
    assert.ok(PACK_ID_RE.test('simple'));
  });
});

test('PACK_SOURCE_TIERS', async (t) => {
  await t.test('includes builtin, user, project', () => {
    assert.ok(PACK_SOURCE_TIERS.includes('builtin'));
    assert.ok(PACK_SOURCE_TIERS.includes('user'));
    assert.ok(PACK_SOURCE_TIERS.includes('project'));
    assert.equal(PACK_SOURCE_TIERS.length, 3);
  });
});