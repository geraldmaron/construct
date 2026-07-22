/**
 * lib/graph/relational/reconcile.mjs — diff-based reconciliation and the
 * incremental-vs-rebuild trust decision (design doc §5).
 *
 * reconcileGraph takes a freshly-seeded node/edge set (the same seeders
 * `build` runs), diffs it against the live SQLite state, and reports what
 * drifted — added/removed/changed nodes and edges — before applying it.
 * Applying reuses the full-rebuild writer (writeGraph) rather than a second,
 * separate partial-apply code path: the diff is computed and reported for
 * trust-decision and diagnosis purposes (design doc: "the diff is both the
 * correction and the diagnosis of which incremental hook is incomplete"),
 * while the actual write goes through the one writer whose correctness is
 * already pinned by the round-trip tests.
 *
 * computeTrustDecision implements the "when incremental is trusted vs when a
 * full rebuild is forced" rule: outbox fully drained, applied-log continuous,
 * every source hash matches, schema at the current migration head, no
 * contested node.
 */

import { withGraphDb } from './sqlite-db.mjs';
import { resolveGraphWorkspace } from './workspace.mjs';
import { writeGraph, loadGraph, readMeta, setFreshness } from './sqlite-store.mjs';
import { normalizeNodes, normalizeEdges } from '../normalize.mjs';
import { outboxState, appliedLogGap } from './outbox.mjs';
import { CURRENT_SCHEMA_VERSION } from './schema-version.mjs';

function attrsEqual(a, b) {
  return JSON.stringify(a ?? {}) === JSON.stringify(b ?? {});
}

function edgeKeyOf(e) { return `${e.from}|${e.rel}|${e.to}`; }

/**
 * @param {Map<string,object>} liveNodes
 * @param {object[]} freshNodes — already normalized (normalizeNodes output).
 */
function diffNodes(liveNodes, freshNodes) {
  const freshById = new Map(freshNodes.map((n) => [n.id, n]));
  const added = [];
  const changed = [];
  for (const n of freshNodes) {
    const live = liveNodes.get(n.id);
    if (!live) { added.push(n.id); continue; }
    if (live.type !== n.type || !attrsEqual(live.attrs, n.attrs)) changed.push(n.id);
  }
  const removed = [...liveNodes.keys()].filter((id) => !freshById.has(id));
  return { added: added.sort(), removed: removed.sort(), changed: changed.sort() };
}

function diffEdges(liveEdges, freshEdges) {
  const liveByKey = new Map(liveEdges.map((e) => [edgeKeyOf(e), e]));
  const freshByKey = new Map(freshEdges.map((e) => [edgeKeyOf(e), e]));
  const added = [];
  const changed = [];
  for (const [key, e] of freshByKey) {
    const live = liveByKey.get(key);
    if (!live) { added.push(key); continue; }
    if (live.weight !== e.weight || JSON.stringify([...live.sources].sort()) !== JSON.stringify([...e.sources].sort())) changed.push(key);
  }
  const removed = [...liveByKey.keys()].filter((key) => !freshByKey.has(key));
  return { added: added.sort(), removed: removed.sort(), changed: changed.sort() };
}

/**
 * @param {string} rootDir
 * @param {{ nodes: object[], edges: object[], generatedAt?: string, sourceHash?: string, sourceHashes?: object }} freshSeed
 * @returns {{ empty: boolean, nodes: object, edges: object, applied: boolean }}
 */
export function reconcileGraph(rootDir, freshSeed) {
  const workspace = resolveGraphWorkspace(rootDir);
  const live = loadGraph(rootDir);
  const freshNodes = normalizeNodes(freshSeed.nodes || []);
  const freshEdges = normalizeEdges(freshSeed.edges || []);

  const nodesDiff = diffNodes(live.nodes, freshNodes);
  const edgesDiff = diffEdges(live.edges, freshEdges);
  const empty = nodesDiff.added.length === 0 && nodesDiff.removed.length === 0 && nodesDiff.changed.length === 0
    && edgesDiff.added.length === 0 && edgesDiff.removed.length === 0 && edgesDiff.changed.length === 0;

  if (empty) {
    withGraphDb(rootDir, (db) => setFreshness(db, workspace, 'fresh', { lastReconciledAt: new Date().toISOString() }));
    return { empty: true, nodes: nodesDiff, edges: edgesDiff, applied: false };
  }

  writeGraph(rootDir, freshSeed);
  withGraphDb(rootDir, (db) => setFreshness(db, workspace, 'fresh', { lastReconciledAt: new Date().toISOString() }));
  return { empty: false, nodes: nodesDiff, edges: edgesDiff, applied: true };
}

/**
 * The trust decision (design doc §5): trust incremental state (no rebuild)
 * only when every condition holds. `freshSourceHashes` is the caller's
 * freshly recomputed per-source hash map (lib/graph/staleness.mjs
 * computeSourceHashes) so this stays free of any source-hashing logic of its
 * own — it only compares what it is given against what is stored.
 *
 * @param {string} rootDir
 * @param {{ freshSourceHashes: Record<string,string> }} opts
 * @returns {{ trustIncremental: boolean, reasons: string[] }}
 */
export function computeTrustDecision(rootDir, { freshSourceHashes = {} } = {}) {
  const workspace = resolveGraphWorkspace(rootDir);
  const reasons = [];

  const outbox = outboxState(rootDir);
  if (outbox.pending > 0 || outbox.failed > 0) reasons.push('outbox has undrained pending/failed events');
  if (outbox.deadLetter > 0) reasons.push('outbox has dead-lettered events');

  const gap = appliedLogGap(rootDir);
  if (gap.hasGap) reasons.push('applied-log has a seq gap');

  const stored = withGraphDb(rootDir, (db) => {
    const rows = db.prepare('SELECT source_name, hash FROM construct_graph_source_hash WHERE workspace = :workspace').all({ ':workspace': workspace });
    return Object.fromEntries(rows.map((r) => [r.source_name, r.hash]));
  });
  const driftedSources = Object.keys(freshSourceHashes).filter((name) => stored[name] !== undefined && stored[name] !== freshSourceHashes[name]);
  if (driftedSources.length) reasons.push(`source(s) drifted without a matching outbox delta: ${driftedSources.join(', ')}`);

  const meta = withGraphDb(rootDir, (db) => readMeta(db, workspace));
  if (meta && meta.schema_version !== CURRENT_SCHEMA_VERSION) reasons.push('schema_version does not match the migration head');

  const contested = withGraphDb(rootDir, (db) => db.prepare(
    `SELECT COUNT(*) AS n FROM construct_graph_nodes WHERE workspace = :workspace AND conflict_status = 'contested'`,
  ).get({ ':workspace': workspace }).n);
  if (contested > 0) reasons.push(`${contested} node(s) carry conflict_status = 'contested'`);

  return { trustIncremental: reasons.length === 0, reasons };
}
