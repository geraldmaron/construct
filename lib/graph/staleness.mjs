/**
 * lib/graph/staleness.mjs — dependency graph seed-hash staleness checks.
 *
 * Compares the hash of registry/contracts/workflow seed files against the
 * hash stored at last graph build (.cx/graph/meta.json). Shared by Oracle,
 * the doctor graph-staleness watcher, and PostToolUse advisories.
 */

import { hashFiles } from './build-from-registry.mjs';
import { loadGraph } from './store.mjs';

export const GRAPH_SEED_FILES = [
  'registry/capabilities.json',
  'specialists/org',
  'lib/embedded-contract/workflow-defs.mjs',
];

/**
 * @param {string} rootDir — project root holding .cx/graph/.
 * @returns {{ present: boolean, stale: boolean, staleReason: string|null, currentHash?: string, storedHash?: string|null }}
 */
export function checkGraphStaleness(rootDir) {
  const graph = loadGraph(rootDir);
  if (!graph.exists) {
    return { present: false, stale: false, staleReason: null };
  }

  try {
    const current = hashFiles(rootDir, GRAPH_SEED_FILES);
    const stored = graph.meta?.sourceHash ?? null;
    if (stored && current !== stored) {
      return {
        present: true,
        stale: true,
        staleReason: 'registry/contracts/workflow seeds changed since last build',
        currentHash: current,
        storedHash: stored,
      };
    }
    return { present: true, stale: false, staleReason: null, currentHash: current, storedHash: stored };
  } catch {
    return { present: true, stale: false, staleReason: null };
  }
}
