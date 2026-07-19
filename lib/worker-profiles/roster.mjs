/**
 * lib/worker-profiles/roster.mjs — lazy Worker Profile catalog for runtime resolution
 * (construct-ymp5).
 *
 * The specialist catalog is resolved at runtime through orchestration_policy rather
 * than inlined into synced orchestrator prompts. Each catalog entry carries id and
 * whenToUse for routing discovery without an always-on prompt block.
 */
import { loadRegistry } from '../registry/loader.mjs';

function loadRegistryForRoot(rootDir = null) {
  return loadRegistry(rootDir ? { rootDir } : {});
}

/**
 * Compact specialist catalog for orchestration_policy responses. Each entry names
 * the cx-prefixed id and the routing hint (when_to_use when present, else description).
 */
export function buildWorkerProfileCatalog({ rootDir = null, includeInternal = true } = {}) {
  const registry = loadRegistryForRoot(rootDir);
  const profiles = Array.isArray(registry.workerProfiles)
    ? registry.workerProfiles
    : Object.values(registry.workerProfiles || {});
  return profiles
    .filter((s) => includeInternal || !s.internal)
    .map((s) => ({
      id: s.id || s.name,
      whenToUse: s.whenToUse || s.when_to_use || s.description || '',
    }));
}

/**
 * Compact text roster shape for human-readable diagnostics.
 */
export function formatWorkerProfileRosterText(catalog) {
  return catalog.map((row) => `- ${row.id}: ${row.whenToUse}`).join('\n');
}
