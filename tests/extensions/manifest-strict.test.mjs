/**
 * tests/extensions/manifest-strict.test.mjs — strict-mode manifest validation.
 *
 * LMCP-N2 Phase 1: extension manifest hardening. Tests the strict option on
 * validateManifest() and loadManifestsFromDir().
 */

import test from 'node:test';
import assert from 'node:assert';
import { validateManifest } from '../../lib/extensions/validate.mjs';
import { loadManifestsFromDir } from '../../lib/extensions/loader.mjs';
import {
  ALLOWED_SECRET_ENV_PREFIXES,
  ESCALATION_SENSITIVE_KINDS,
  KNOWN_REQUESTABLE_TOOL_GRANTS,
  BUILTIN_SPECIALIST_IDS,
} from '../../lib/extensions/manifest-schema.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MANIFESTS_DIR = join(__dirname, '../../lib/extensions/manifests');

const validManifest = { id: 'test-valid', version: '1.0.0', kind: 'model' };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

test('ALLOWED_SECRET_ENV_PREFIXES', async (t) => {
  await t.test('exports a non-empty array', () => {
    assert.ok(Array.isArray(ALLOWED_SECRET_ENV_PREFIXES));
    assert.ok(ALLOWED_SECRET_ENV_PREFIXES.length > 10);
  });

  await t.test('includes GITHUB_ and CONSTRUCT_', () => {
    assert.ok(ALLOWED_SECRET_ENV_PREFIXES.includes('GITHUB_'));
    assert.ok(ALLOWED_SECRET_ENV_PREFIXES.includes('CONSTRUCT_'));
  });
});

test('ESCALATION_SENSITIVE_KINDS', async (t) => {
  await t.test('includes specialist-pack and mcp-tool', () => {
    assert.ok(ESCALATION_SENSITIVE_KINDS.includes('specialist-pack'));
    assert.ok(ESCALATION_SENSITIVE_KINDS.includes('mcp-tool'));
  });
});

test('KNOWN_REQUESTABLE_TOOL_GRANTS', async (t) => {
  await t.test('includes shell, exec, network, filesystem', () => {
    assert.ok(KNOWN_REQUESTABLE_TOOL_GRANTS.includes('shell'));
    assert.ok(KNOWN_REQUESTABLE_TOOL_GRANTS.includes('exec'));
    assert.ok(KNOWN_REQUESTABLE_TOOL_GRANTS.includes('network'));
    assert.ok(KNOWN_REQUESTABLE_TOOL_GRANTS.includes('filesystem'));
  });
});

test('BUILTIN_SPECIALIST_IDS', async (t) => {
  await t.test('includes all core specialists', () => {
    assert.ok(BUILTIN_SPECIALIST_IDS.includes('researcher'));
    assert.ok(BUILTIN_SPECIALIST_IDS.includes('engineer'));
    assert.ok(BUILTIN_SPECIALIST_IDS.includes('architect'));
    assert.ok(BUILTIN_SPECIALIST_IDS.includes('orchestrator'));
  });
});

// ---------------------------------------------------------------------------
// Strict-mode validation
// ---------------------------------------------------------------------------

test('validateManifest strict mode', async (t) => {
  await t.test('1. unknown field rejected in strict mode', () => {
    const result = validateManifest(
      { id: 'test', version: '1.0.0', kind: 'mcp-tool', nonsenseField: true },
      { strict: true }
    );
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("unknown field 'nonsenseField'")));
  });

  await t.test('2. unknown field accepted in non-strict mode', () => {
    const result = validateManifest(
      { id: 'test', version: '1.0.0', kind: 'mcp-tool', nonsenseField: true }
    );
    assert.equal(result.valid, true);
  });

  await t.test('3. malicious env key rejected in strict mode', () => {
    const result = validateManifest(
      { id: 'test', version: '1.0.0', kind: 'data-source', secretEnvKeys: ['HOME', 'PATH', 'ANY_SECRET'] },
      { strict: true }
    );
    assert.equal(result.valid, false);
    for (const bad of ['HOME', 'PATH', 'ANY_SECRET']) {
      assert.ok(result.errors.some((e) => e.includes(`secretEnvKey '${bad}'`)));
    }
  });

  await t.test('4. valid env key accepted in strict mode', () => {
    const result = validateManifest(
      { id: 'test', version: '1.0.0', kind: 'data-source', secretEnvKeys: ['GITHUB_TOKEN'] },
      { strict: true }
    );
    assert.equal(result.valid, true);
  });

  await t.test('5. current builtin manifests pass strict mode', () => {
    const result = loadManifestsFromDir(MANIFESTS_DIR, { strict: true });
    assert.equal(result.errors.length, 0, `strict mode errors: ${result.errors.join(', ')}`);
    assert.ok(result.manifests.length >= 1);
  });

  await t.test('6. tool grant escalation check — known grants pass', () => {
    const result = validateManifest(
      { id: 'test-pack', version: '1.0.0', kind: 'specialist-pack', toolGrantsRequested: ['shell', 'exec'] },
      { strict: true }
    );
    assert.equal(result.valid, true);
  });

  await t.test('6b. tool grant escalation check — unknown grant rejected', () => {
    const result = validateManifest(
      { id: 'test-pack', version: '1.0.0', kind: 'specialist-pack', toolGrantsRequested: ['rm-rf'] },
      { strict: true }
    );
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("toolGrantsRequested 'rm-rf'")));
  });

  await t.test('6c. tool grant escalation check — non-sensitive kind bypasses check', () => {
    const result = validateManifest(
      { id: 'test-model', version: '1.0.0', kind: 'model', toolGrantsRequested: ['rm-rf'] },
      { strict: true }
    );
    assert.equal(result.valid, true);
  });

  await t.test('7. builtin prompt shadowing rejected without override', () => {
    const result = validateManifest(
      { id: 'test-pack', version: '1.0.0', kind: 'specialist-pack', prompts: [{ specialist: 'researcher' }] },
      { strict: true }
    );
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('researcher')));
    assert.ok(result.errors.some((e) => e.includes('override')));
  });

  await t.test('7b. builtin prompt shadowing allowed with override', () => {
    const result = validateManifest(
      { id: 'test-pack', version: '1.0.0', kind: 'specialist-pack', prompts: [{ specialist: 'researcher', override: true }] },
      { strict: true }
    );
    assert.equal(result.valid, true);
  });

  await t.test('7c. non-builtin specialist prompt is fine', () => {
    const result = validateManifest(
      { id: 'test-pack', version: '1.0.0', kind: 'specialist-pack', prompts: [{ specialist: 'acme-custom-analyst' }] },
      { strict: true }
    );
    assert.equal(result.valid, true);
  });

  await t.test('8. owner validation — unknown cx- owner rejected', () => {
    const result = validateManifest(
      { id: 'test', version: '1.0.0', kind: 'model', owner: 'cx-fake-specialist' },
      { strict: true }
    );
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('cx-fake-specialist')));
  });

  await t.test('8b. non-cx owner is fine', () => {
    const result = validateManifest(
      { id: 'test', version: '1.0.0', kind: 'model', owner: 'acme-team' },
      { strict: true }
    );
    assert.equal(result.valid, true);
  });

  await t.test('9. invalid certification.tier rejected in strict mode', () => {
    const result = validateManifest(
      { id: 'test', version: '1.0.0', kind: 'data-source', certification: { tier: 'not-a-real-tier' } },
      { strict: true }
    );
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("certification.tier 'not-a-real-tier'")));
  });

  await t.test('9b. valid certification.tier accepted in strict mode', () => {
    const result = validateManifest(
      { id: 'test', version: '1.0.0', kind: 'data-source', certification: { tier: 'contract-tested' } },
      { strict: true }
    );
    assert.equal(result.valid, true);
  });

  await t.test('strict=false by default, no breaking change', () => {
    const result = validateManifest({ id: 'test', version: '1.0.0', kind: 'mcp-tool', nonsenseField: true });
    assert.equal(result.valid, true);
  });
});