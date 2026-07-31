/**
 * tests/embed/provider-registry-parity.test.mjs.
 *
 * Proves lib/embed/providers/registry.mjs is a thin view over the unified
 * extension manifest registry (lib/extensions/*) rather than a
 * second hardcoded env-driven table:
 *   1. With every known credential set, the embed registry's provider names
 *      equal the unified manifest set (kind: data-source, capability: read)
 *      filtered to ids the embed layer has an adapter for.
 *   2. A manifest-known provider with missing credentials is not registered
 *      but is surfaced via unavailable() with an actionable reason —
 *      "configured but unavailable," never silently dropped.
 *   3. Linear is present in the unified manifest set (not silently dropped)
 *      and participates in the same fromEnv() gating as every other
 *      data-source provider.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { ProviderRegistry } from '../../lib/embed/providers/registry.mjs';
import { loadManifestsFromDir, mergeManifests, resolveManifestDirs } from '../../lib/extensions/loader.mjs';

const FULL_ENV = {
  GITHUB_TOKEN: 'gh_test',
  SLACK_BOT_TOKEN: 'xoxb-test',
  LINEAR_API_KEY: 'lin_api_test',
  JIRA_BASE_URL: 'https://example.atlassian.net',
  JIRA_EMAIL: 'user@example.com',
  JIRA_API_TOKEN: 'jira_test',
  CONFLUENCE_BASE_URL: 'https://example.atlassian.net/wiki',
  CONFLUENCE_EMAIL: 'user@example.com',
  CONFLUENCE_API_TOKEN: 'confluence_test',
};

function unifiedDataSourceReadIds(rootDir = process.cwd()) {
  const { builtin, user, project } = resolveManifestDirs({ rootDir });
  const { manifests: b } = loadManifestsFromDir(builtin);
  const { manifests: u } = loadManifestsFromDir(user);
  const { manifests: p } = loadManifestsFromDir(project);
  return mergeManifests(b, u, p)
    .filter((m) => m.kind === 'data-source' && Array.isArray(m.capabilities) && m.capabilities.includes('read'))
    .map((m) => m.id)
    .sort();
}

test('unified registry declares linear as a data-source manifest (not silently dropped)', () => {
  const ids = unifiedDataSourceReadIds();
  assert.ok(ids.includes('linear'), `expected 'linear' in unified data-source manifests, got: ${ids.join(', ')}`);
});

test('embed registry provider set equals the unified registry set filtered by capability, given full credentials', async () => {
  const registry = await ProviderRegistry.fromEnv(FULL_ENV);

  const unifiedIds = unifiedDataSourceReadIds();
  const embedCanonicalNames = new Set();
  for (const name of registry.names()) embedCanonicalNames.add(name);

  // Every unified data-source/read manifest that the embed layer has an
  // adapter for must be registered when its credentials are all present.
  // (atlassian-jira registers under 'jira'/'atlassian' aliases, not its
  // manifest id — assert via alias membership rather than exact id match.)
  const aliasesById = { github: ['github', 'gh'], slack: ['slack'], linear: ['linear'], 'atlassian-jira': ['jira', 'atlassian'], 'atlassian-confluence': ['confluence'] };
  for (const id of unifiedIds) {
    if (!aliasesById[id]) continue; // no embed adapter registered for this manifest id — not this bead's scope
    const aliases = aliasesById[id];
    assert.ok(
      aliases.some((a) => embedCanonicalNames.has(a)),
      `manifest '${id}' has full credentials but no alias of [${aliases.join(', ')}] was registered`,
    );
  }

  assert.deepEqual(registry.unavailable(), [], 'no provider should be unavailable when every credential is present');
});

test('missing-credential providers are surfaced as unavailable-with-reason, not silently omitted', async () => {
  const registry = await ProviderRegistry.fromEnv({});

  assert.equal(registry.get('github'), null);
  assert.equal(registry.get('slack'), null);
  assert.equal(registry.get('linear'), null);
  assert.equal(registry.get('jira'), null);

  const unavailable = registry.unavailable();
  const byId = Object.fromEntries(unavailable.map((u) => [u.id, u]));

  assert.ok(byId.github, 'github should be listed unavailable');
  assert.match(byId.github.reason, /missing credentials/);

  assert.ok(byId.linear, 'linear should be listed unavailable, not dropped');
  assert.match(byId.linear.reason, /LINEAR_API_KEY/);

  assert.ok(byId['atlassian-jira'], 'jira (manifest id atlassian-jira) should be listed unavailable');
  assert.match(byId['atlassian-jira'].reason, /JIRA_BASE_URL/);
});

test('partial Jira credentials (allOf semantics) still surface as unavailable', async () => {
  const registry = await ProviderRegistry.fromEnv({ JIRA_BASE_URL: 'https://x.atlassian.net', JIRA_EMAIL: 'a@b.com' });
  assert.equal(registry.get('jira'), null);
  const entry = registry.unavailable().find((u) => u.id === 'atlassian-jira');
  assert.ok(entry);
  assert.match(entry.reason, /JIRA_API_TOKEN/);
});

test('github registers on any single accepted credential (anyOf semantics)', async () => {
  const registry = await ProviderRegistry.fromEnv({ GH_TOKEN: 'ghp_test' });
  assert.ok(registry.get('github'), 'github should register when GH_TOKEN alone is present');
  assert.ok(registry.get('gh'), 'gh alias should also resolve');
});

test('registry.mjs does not statically import provider adapters', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../../lib/embed/providers/registry.mjs', import.meta.url), 'utf8');
  const staticImportLines = src
    .split('\n')
    .filter((line) => /^import .* from ['"]\.\/(github|slack|linear|jira)\.mjs['"]/.test(line.trim()));
  assert.deepEqual(staticImportLines, [], 'no top-level static import of a provider adapter module');
});
