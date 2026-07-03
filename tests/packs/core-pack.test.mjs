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
    assert.ok(pack.specialists.length >= 20);
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
});