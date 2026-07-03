/**
 * tests/packs/validate.test.mjs — pack manifest validator unit tests.
 */

import test from 'node:test';
import assert from 'node:assert';
import { validatePackManifest } from '../../lib/packs/validate.mjs';
import { PACK_REQUIRED_FIELDS, PACK_COMPAT_VERSION } from '../../lib/packs/manifest-schema.mjs';

const validManifest = { id: '@org/test-pack', version: '1.0.0', compatVersion: 1 };

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