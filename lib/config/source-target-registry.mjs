/**
 * lib/config/source-target-registry.mjs — manifest-derived source-target descriptors.
 *
 * Loads the merged (builtin/user/project) extension manifests and collects each
 * manifest's optional `sourceTarget` block into a descriptor keyed by the block's
 * own `provider` field — the string used in construct.config.json's
 * `sources.targets[].provider`, in legacy env-derived targets, and in embed
 * source records. That key is distinct from the manifest `id` for providers
 * whose manifest id differs from their config-facing provider name (the Jira
 * manifest id is `atlassian-jira`; its sourceTarget.provider is `jira`).
 *
 * lib/config/source-targets.mjs and lib/embed/demand-fetch.mjs iterate these
 * descriptors instead of naming providers directly, so adding a fifth
 * source-target-eligible provider requires only a manifest with a
 * `sourceTarget` block — no edits to either file. See each descriptor field
 * for its consumer:
 *   selector / secondaryField      — validateSourceTarget, normalizeConfigTarget
 *   signature                      — targetSignature
 *   legacyEnv                      — legacyEnvSourceTargets
 *   aliases                        — resolveKnownSourcesFromTargets
 *   embed                          — targetsToEmbedSources
 *   embedFilters                   — targetsToEmbedSourcesWithFilters
 *   demandFetch.target*            — lib/embed/demand-fetch.mjs buildReadCallsForTarget
 *   demandFetch.query*             — lib/embed/demand-fetch.mjs buildReadCalls
 *
 * Computed once at module load (mirrors the BUILT_INS pattern in
 * lib/providers/registry.mjs) using the default rootDir (process.cwd()).
 * Callers that need a project-tier-aware view for a different rootDir should
 * call loadSourceTargetDescriptors(rootDir) directly.
 */

import { loadManifestsFromDir, mergeManifests, resolveManifestDirs } from '../extensions/loader.mjs';

export function loadSourceTargetDescriptors(rootDir = process.cwd()) {
  const { builtin, user, project } = resolveManifestDirs({ rootDir });
  const { manifests: builtinManifests } = loadManifestsFromDir(builtin);
  const { manifests: userManifests } = loadManifestsFromDir(user);
  const { manifests: projectManifests } = loadManifestsFromDir(project);
  const merged = mergeManifests(builtinManifests, userManifests, projectManifests);

  const byProvider = new Map();
  for (const manifest of merged) {
    const descriptor = manifest.sourceTarget;
    if (!descriptor || typeof descriptor !== 'object' || !descriptor.provider) continue;
    byProvider.set(descriptor.provider, descriptor);
  }
  return byProvider;
}

const DESCRIPTORS = loadSourceTargetDescriptors();

export const SOURCE_TARGET_PROVIDERS = Object.freeze([...DESCRIPTORS.keys()]);

export function getSourceTargetDescriptor(provider) {
  return DESCRIPTORS.get(provider) ?? null;
}

export function listSourceTargetDescriptors() {
  return [...DESCRIPTORS.values()];
}

/**
 * Fill a descriptor string template's `{name}` placeholders from `vars`.
 * Shared by lib/config/source-targets.mjs (signatures) and
 * lib/embed/demand-fetch.mjs (JQL construction) so both consume the same
 * placeholder syntax the manifests declare.
 */
export function renderTemplate(template, vars) {
  return template.replace(/\{(\w+)\}/g, (_, key) => (key in vars ? String(vars[key]) : ''));
}
