/**
 * tests/extensions/manifest.test.mjs — extension manifest validator unit tests.
 *
 * LMCP-B1: validates the manifest schema, required fields, kind registry,
 * semver versioning, forward-compat guard, loader, and constants.
 */

import test from 'node:test';
import assert from 'node:assert';
import { validateManifest } from '../../lib/extensions/validate.mjs';
import { MANIFEST_KINDS, REQUIRED_FIELDS, COMPAT_VERSION } from '../../lib/extensions/manifest-schema.mjs';
import { loadManifestsFromDir } from '../../lib/extensions/loader.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MANIFESTS_DIR = join(__dirname, '../../lib/extensions/manifests');

const validManifest = { id: 'test-valid', version: '1.0.0', kind: 'model' };

test('validateManifest', async (t) => {
  await t.test('valid manifest returns valid:true', () => {
    const result = validateManifest(validManifest);
    assert.deepEqual(result, { valid: true });
  });

  await t.test('missing required field returns error naming the field', () => {
    for (const field of REQUIRED_FIELDS) {
      const m = { ...validManifest };
      delete m[field];
      const result = validateManifest(m);
      assert.equal(result.valid, false);
      assert.ok(result.errors.some((e) => e.includes(`missing required field: ${field}`)),
        `should detect missing ${field}`);
    }
  });

  await t.test('unknown kind returns error with kind name and allowed list', () => {
    const result = validateManifest({ ...validManifest, kind: 'unknown-type' });
    assert.equal(result.valid, false);
    assert.ok(result.errors[0].includes('unknown-type'));
    assert.ok(result.errors[0].includes(MANIFEST_KINDS.join(', ')));
  });

  await t.test('invalid version format returns error', () => {
    const result = validateManifest({ ...validManifest, version: 'not-semver' });
    assert.equal(result.valid, false);
    assert.ok(result.errors[0].includes('semver'));
  });

  await t.test('forward-compat guard catches compatVersion > COMPAT_VERSION', () => {
    const result = validateManifest({ ...validManifest, compatVersion: COMPAT_VERSION + 1 });
    assert.equal(result.valid, false);
    assert.ok(result.errors[0].includes('compatVersion'));
  });

  await t.test('filePath appears in error messages when provided', () => {
    const result = validateManifest({}, { filePath: '/test/path/manifest.json' });
    assert.equal(result.valid, false);
    assert.ok(result.errors[0].includes('/test/path/manifest.json'));
  });

  await t.test('non-object manifest returns error', () => {
    assert.equal(validateManifest(null).valid, false);
    assert.equal(validateManifest('string').valid, false);
    assert.equal(validateManifest([]).valid, false);
  });
});

test('loadManifestsFromDir', async (t) => {
  await t.test('loads echo.manifest.json from builtin dir', () => {
    const result = loadManifestsFromDir(MANIFESTS_DIR);
    assert.ok(result.manifests.length >= 1);
    const echo = result.manifests.find((m) => m.id === 'echo');
    assert.ok(echo);
    assert.equal(echo.version, '1.0.0');
    assert.equal(echo.kind, 'mcp-tool');
  });

  await t.test('non-existent dir returns empty manifests with no error', () => {
    const result = loadManifestsFromDir('/tmp/non-existent-extensions-dir');
    assert.deepEqual(result.manifests, []);
    assert.deepEqual(result.errors, []);
  });
});

test('MANIFEST_KINDS and REQUIRED_FIELDS constants', async (t) => {
  await t.test('required fields include id, version, kind', () => {
    assert.ok(REQUIRED_FIELDS.includes('id'));
    assert.ok(REQUIRED_FIELDS.includes('version'));
    assert.ok(REQUIRED_FIELDS.includes('kind'));
  });

  await t.test('MANIFEST_KINDS includes model and mcp-tool', () => {
    assert.ok(MANIFEST_KINDS.includes('model'));
    assert.ok(MANIFEST_KINDS.includes('mcp-tool'));
    assert.ok(MANIFEST_KINDS.length >= 13);
  });
});