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

  await t.test('specialists array contains expected specialists', () => {
    const pack = loadCorePack(PACKAGE_ROOT);
    assert.ok(Array.isArray(pack.specialists));
    // construct-rf26.11 consolidated the 29-specialist roster to 12 (orchestrator + 11 workers).
    assert.ok(pack.specialists.length >= 12);
    assert.ok(pack.specialists.includes('cx-architect'));
    assert.ok(pack.specialists.includes('cx-engineer'));
    assert.ok(pack.specialists.includes('cx-orchestrator'));
  });

  await t.test('teams array contains expected teams', () => {
    const pack = loadCorePack(PACKAGE_ROOT);
    assert.ok(Array.isArray(pack.teams));
    assert.ok(pack.teams.length >= 5);
    assert.ok(pack.teams.includes('engineering-team'));
  });

  await t.test('prompts map contains entries', () => {
    const pack = loadCorePack(PACKAGE_ROOT);
    assert.ok(typeof pack.prompts === 'object');
    assert.ok(Object.keys(pack.prompts).length >= 5);
    assert.equal(pack.prompts['cx-architect'], 'specialists/prompts/cx-architect.md');
    assert.equal(pack.prompts['cx-engineer'], 'specialists/prompts/cx-engineer.md');
  });

  await t.test('embedBindings ships default grants for product-manager, operations, engineer (LMCP-E4)', () => {
    const pack = loadCorePack(PACKAGE_ROOT);
    assert.ok(typeof pack.embedBindings === 'object');
    assert.ok(pack.embedBindings['cx-product-manager']);
    assert.ok(pack.embedBindings['cx-operations']);
    assert.ok(pack.embedBindings['cx-engineer']);
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

  await t.test("every default proposal token references a provider present in that specialist's providers[]", () => {
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