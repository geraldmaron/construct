/**
 * tests/extensions/manifest-providers.test.mjs — LMCP-B2 provider manifest tests.
 *
 * Validates that the 5 built-in provider manifests (github, atlassian-jira,
 * atlassian-confluence, slack, salesforce) load correctly, have the correct
 * kind, and that resolveProviders() discovers all 5.
 */

import test from 'node:test';
import assert from 'node:assert';
import { loadManifestsFromDir, resolveManifestDirs } from '../../lib/extensions/loader.mjs';
import { resolveProviders } from '../../lib/providers/registry.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MANIFESTS_DIR = join(__dirname, '../../lib/extensions/manifests');

const EXPECTED_PROVIDERS = ['github', 'atlassian-jira', 'atlassian-confluence', 'slack', 'salesforce'];

test('built-in provider manifests', async (t) => {
  await t.test('loadManifestsFromDir loads all 5 manifests without errors', () => {
    const { manifests, errors } = loadManifestsFromDir(MANIFESTS_DIR);
    assert.deepEqual(errors, [], 'manifest loading should produce no errors');
    const dataSourceManifests = manifests.filter((m) => m.kind === 'data-source');
    assert.equal(dataSourceManifests.length, 5, 'should have exactly 5 data-source manifests');
  });

  await t.test('each data-source manifest has correct kind', () => {
    const { manifests } = loadManifestsFromDir(MANIFESTS_DIR);
    const dataSourceManifests = manifests.filter((m) => m.kind === 'data-source');
    for (const m of dataSourceManifests) {
      assert.equal(m.kind, 'data-source', `${m.id} should be data-source`);
    }
  });

  await t.test('all expected provider ids are present in manifests', () => {
    const { manifests } = loadManifestsFromDir(MANIFESTS_DIR);
    const manifestIds = manifests.filter((m) => m.kind === 'data-source').map((m) => m.id);
    for (const id of EXPECTED_PROVIDERS) {
      assert.ok(manifestIds.includes(id), `manifest for '${id}' should exist`);
    }
  });

  await t.test('resolveProviders returns entries for all 5 providers', async () => {
    const { providers, errors } = await resolveProviders();
    assert.deepEqual(errors, [], 'provider resolution should produce no errors');
    for (const id of EXPECTED_PROVIDERS) {
      assert.ok(providers[id], `resolveProviders should include '${id}'`);
      assert.equal(providers[id].meta.id, id);
    }
  });

  await t.test('BUILT_INS export matches manifest-driven ids', async () => {
    const { manifests } = loadManifestsFromDir(MANIFESTS_DIR);
    const manifestIds = manifests.filter((m) => m.kind === 'data-source').map((m) => m.id).sort();
    const { BUILT_INS } = await import('../../lib/providers/registry.mjs');
    assert.deepEqual([...BUILT_INS].sort(), manifestIds);
  });
});
