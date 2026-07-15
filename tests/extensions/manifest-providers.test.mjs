/**
 * tests/extensions/manifest-providers.test.mjs — LMCP-B2 provider manifest tests.
 *
 * Validates that the built-in provider manifests (github, atlassian-jira,
 * atlassian-confluence, slack, salesforce, directory, feedback) load
 * correctly, have the correct kind, and that resolveProviders() discovers
 * the ones with a unified lib/providers/<id> adapter. Linear (added in
 * LMCP-B3) and git (construct-wjap9.1 — a source-target-only provider with
 * no unified read/write adapter, only corpus-caching via
 * lib/sources/repo-cache.mjs) have manifests but no unified adapter yet —
 * both are asserted separately from resolveProviders() coverage rather
 * than folded into EXPECTED_PROVIDERS.
 */

import test from 'node:test';
import assert from 'node:assert';
import { loadManifestsFromDir, resolveManifestDirs } from '../../lib/extensions/loader.mjs';
import { resolveProviders } from '../../lib/providers/registry.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MANIFESTS_DIR = join(__dirname, '../../lib/extensions/manifests');

const EXPECTED_PROVIDERS = ['github', 'atlassian-jira', 'atlassian-confluence', 'slack', 'salesforce', 'directory', 'feedback'];
const MANIFEST_ONLY_PROVIDERS = ['linear', 'git'];

test('built-in provider manifests', async (t) => {
  await t.test('loadManifestsFromDir loads all 9 manifests without errors', () => {
    const { manifests, errors } = loadManifestsFromDir(MANIFESTS_DIR);
    assert.deepEqual(errors, [], 'manifest loading should produce no errors');
    const dataSourceManifests = manifests.filter((m) => m.kind === 'data-source');
    assert.equal(
      dataSourceManifests.length,
      9,
      'should have exactly 9 data-source manifests (7 unified + 2 manifest-only)',
    );
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
    for (const id of [...EXPECTED_PROVIDERS, ...MANIFEST_ONLY_PROVIDERS]) {
      assert.ok(manifestIds.includes(id), `manifest for '${id}' should exist`);
    }
  });

  await t.test('resolveProviders returns entries for all 7 providers', async () => {
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

  await t.test('linear manifest exists but has no unified lib/providers/<id> adapter yet', () => {
    const { manifests } = loadManifestsFromDir(MANIFESTS_DIR);
    const linear = manifests.find((m) => m.id === 'linear');
    assert.ok(linear, 'linear manifest should exist (LMCP-B3 — not silently dropped)');
    assert.equal(linear.kind, 'data-source');
    assert.ok(linear.capabilities.includes('read'));
  });

  await t.test('git manifest exists but has no unified lib/providers/<id> adapter (source-target + corpus cache only)', () => {
    const { manifests } = loadManifestsFromDir(MANIFESTS_DIR);
    const git = manifests.find((m) => m.id === 'git');
    assert.ok(git, 'git manifest should exist (construct-wjap9.1 — not silently dropped)');
    assert.equal(git.kind, 'data-source');
    assert.ok(git.capabilities.includes('read'));
    assert.ok(git.sourceTarget, 'git is source-target-eligible');
  });
});
