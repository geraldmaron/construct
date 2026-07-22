/**
 * tests/packs/core-pack.test.mjs — core pack loader unit tests.
 */

import test from 'node:test';
import assert from 'node:assert';
import { loadCorePack } from '../../lib/packs/core-pack.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(__dirname, '../..');

test('loadCorePack', async (t) => {
  await t.test('returns valid pack with id @construct/core', () => {
    const pack = loadCorePack(PACKAGE_ROOT);
    assert.equal(pack.id, '@construct/core');
    assert.equal(pack.version, '0.0.0');
    assert.equal(pack.compatVersion, 1);
    assert.equal(pack._tier, 'builtin');
  });

  await t.test('Worker Profile array contains expected profiles', () => {
    const pack = loadCorePack(PACKAGE_ROOT);
    assert.ok(Array.isArray(pack.workerProfiles));
    assert.ok(pack.workerProfiles.length >= 12);
    assert.ok(pack.workerProfiles.includes('architect'));
    assert.ok(pack.workerProfiles.includes('engineer'));
    assert.ok(pack.workerProfiles.includes('orchestrator'));
  });

  await t.test('prompts map contains entries', () => {
    const pack = loadCorePack(PACKAGE_ROOT);
    assert.ok(typeof pack.prompts === 'object');
    assert.ok(Object.keys(pack.prompts).length >= 5);
    assert.equal(pack.prompts.architect, 'registry/worker-profiles/prompts/architect.md');
    assert.equal(pack.prompts.engineer, 'registry/worker-profiles/prompts/engineer.md');
  });

  await t.test('embedBindings ships default grants for product-manager, operations, engineer (LMCP-E4)', () => {
    const pack = loadCorePack(PACKAGE_ROOT);
    assert.ok(typeof pack.embedBindings === 'object');
    assert.ok(pack.embedBindings['product-manager']);
    assert.ok(pack.embedBindings['operations']);
    assert.ok(pack.embedBindings['engineer']);
  });

  await t.test('every default binding only names capabilities from EMBED_BINDING_CAPABILITIES', () => {
    const pack = loadCorePack(PACKAGE_ROOT);
    for (const binding of Object.values(pack.embedBindings)) {
      for (const p of binding.providers || []) {
        for (const cap of p.capabilities) {
          assert.ok(['read', 'search'].includes(cap));
        }
      }
    }
  });

  await t.test("every default proposal token references a provider granted to that Worker Profile", () => {
    const pack = loadCorePack(PACKAGE_ROOT);
    for (const binding of Object.values(pack.embedBindings)) {
      const boundIds = new Set((binding.providers || []).map(p => p.id));
      for (const token of binding.proposals || []) {
        const [providerId] = token.split('.');
        assert.ok(boundIds.has(providerId), `${token} should reference a bound provider`);
      }
    }
  });
});
