/**
 * lib/specialists/roster.mjs — lazy specialist catalog for runtime resolution
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
export function buildSpecialistCatalog({ rootDir = null, includeInternal = true } = {}) {
  const registry = loadRegistryForRoot(rootDir);
  const prefix = registry.prefix || 'cx';
  const specialists = Array.isArray(registry.specialists)
    ? registry.specialists
    : Object.values(registry.specialists || {});
  return specialists
    .filter((s) => includeInternal || !s.internal)
    .map((s) => ({
      id: `${prefix}-${s.name}`,
      whenToUse: s.when_to_use || s.description || '',
    }));
}

/**
 * Legacy text roster shape retained for tests and migration comparisons.
 */
export function formatSpecialistRosterText(catalog) {
  return catalog.map((row) => `- ${row.id}: ${row.whenToUse}`).join('\n');
}
