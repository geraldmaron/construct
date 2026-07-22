/**
 * lib/graph/build-from-corpus.mjs — corpus-annotation edges for the dependency graph.
 *
 * buildFromRegistry only derives test --validates--> capability edges from
 * registry/capabilities.json's verification.functional / hostEmulation pointers,
 * so a capability verified solely by unit/integration tests (e.g. local.model.tier,
 * which declares an explicit untestableRationale for functional coverage) or a
 * capability tracked only in tests/capabilities/ledger.json never gets an edge.
 * Walking @capability annotations across the whole test corpus (via
 * lib/test-corpus-inventory.mjs) and emitting the same validates edge shape,
 * sourced 'corpus-annotation', closes that gap and merges with (rather than
 * replaces) registry-derived edges in the store's dedup-by-key write path.
 *
 * A capability id tagged in a test but absent from both registry/capabilities.json
 * and tests/capabilities/ledger.json is not a fabricated node — the ledger and
 * registry are the id authorities — so annotation-only ids without a known
 * capability node are skipped and reported back to the caller as orphaned tags.
 *
 * The ledger file is optional (a missing file is a normal, silent no-op), but
 * a ledger that exists and fails to parse is a real problem — it silently
 * drops every ledger-only capability node and its validates edges — so that
 * case is captured in `warnings` instead of being treated the same as "no
 * ledger" (construct-4uxq0.9.16).
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { extractCapabilityTestEdges } from '../test-corpus-inventory.mjs';
import { loadCapabilityRegistry } from '../registry/validate.mjs';
import { defaultLedgerPath } from '../capability-ledger.mjs';
import { nodeId } from './store.mjs';

function readLedger(filePath, warnings) {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (err) {
    warnings.push(`capability ledger failed to parse (${filePath}): ${err.message}`);
    return null;
  }
}

/**
 * @param {object} opts
 * @param {string} opts.rootDir
 * @returns {{ nodes: object[], edges: object[], orphanedCapabilityIds: string[], warnings: string[] }}
 */
export function buildFromCorpus({ rootDir }) {
  const warnings = [];
  const registry = loadCapabilityRegistry({ rootDir });
  const registryIds = new Set((registry.capabilities ?? []).map((cap) => cap.id).filter(Boolean));

  const ledger = readLedger(defaultLedgerPath(rootDir), warnings);
  const ledgerIds = new Set((ledger?.capabilities ?? []).map((cap) => cap.id).filter(Boolean));

  const nodes = [];
  const edges = [];
  const orphaned = new Set();
  const ledgerNodesEmitted = new Set();

  for (const { testPath, capabilityId } of extractCapabilityTestEdges({ rootDir })) {
    const known = registryIds.has(capabilityId) || ledgerIds.has(capabilityId);
    if (!known) { orphaned.add(capabilityId); continue; }

    // Ledger-only capabilities (not in registry/capabilities.json) have no
    // node anywhere else in the graph, so this is the sole place they're created.

    if (!registryIds.has(capabilityId) && !ledgerNodesEmitted.has(capabilityId)) {
      ledgerNodesEmitted.add(capabilityId);
      nodes.push({ id: nodeId('capability', capabilityId), type: 'capability', name: capabilityId, attrs: { source: 'ledger' } });
    }

    const testId = nodeId('test', testPath);
    nodes.push({ id: testId, type: 'test', name: testPath, attrs: { path: testPath, exists: true } });
    edges.push({ from: testId, to: nodeId('capability', capabilityId), rel: 'validates', source: 'corpus-annotation' });
  }

  return { nodes, edges, orphanedCapabilityIds: [...orphaned].sort(), warnings };
}
