/**
 * lib/graph/relational/queries.mjs — recursive-CTE query surface (design doc
 * §6/§7, portable SQL text shared with docs/notes/research/workspace-control-
 * plane/synthesis/graph-store/queries.sql). Backs the directive §4.8 command
 * surface capabilities the JSONL store never had: path, orphans, cycles,
 * owners, requirements, plus the up/down/impact ports of store.mjs
 * dependentsOf/dependenciesOf and impact.mjs reverseImportClosure.
 *
 * Portability rules kept intentionally (so SQLite and Postgres return
 * identical rows): TEXT path accumulator (`'|'||id||'|'`), LIKE-based cycle
 * guard, no backend-specific functions (group_concat/string_agg, instr/
 * strpos). Two rel filters the original design template hardcoded to
 * not-yet-migrated target-ontology names ('depends-on', 'owned-by') are
 * parameters here instead (:impact_rel, :owner_rel, :requirement_rel_N,
 * :orphan_rel_N, :down_rel_N, :up_rel_N, :path_rel_N) bound to the vocabulary
 * the live seeders actually populate (imports, uses, realizes, validates,
 * owned_by) — see the design-doc correction recorded in
 * graph-store-design.md §14.
 *
 * queryDown/queryUp/queryPath/queryImpact hang on hub-scale nodes if run
 * unbounded over the dense 'imports' relation (construct-b0nny.12, reproduced
 * in docs/notes/research/workspace-control-plane/synthesis/spike-a-graph-
 * foundation.md: 2s at depth 3, 12-30s hard kills at depth 5+ or on a real
 * 148-importer hub, on this repo's own graph where 'imports' is 52.8% of all
 * edges). The no-dedup path accumulator means the same descendant reached via
 * multiple diamond-shaped paths is recomputed once per path, so row count
 * grows combinatorially with depth over a dense relation, not linearly.
 * queryDown/queryUp/queryPath default their rel filter away from 'imports'
 * (DEFAULT_TRAVERSAL_RELS, same rationale DEFAULT_CYCLE_RELS already
 * documents) since a caller can opt back into a dense relation explicitly.
 * queryImpact cannot do the same — 'imports' is its whole purpose — so it
 * instead defaults to a much lower max depth (DEFAULT_IMPACT_MAX_DEPTH).
 */

import { withGraphDb } from './sqlite-db.mjs';
import { resolveGraphWorkspace } from './workspace.mjs';

export const QUERY_DOWN = `
WITH RECURSIVE downstream(id, depth, path) AS (
  SELECT :node_id, 0, '|' || :node_id || '|'
  UNION ALL
  SELECT e.from_id, d.depth + 1, d.path || e.from_id || '|'
  FROM construct_graph_edges e
  JOIN downstream d ON e.to_id = d.id
  WHERE e.workspace = :workspace
    AND e.state = 'active'
    AND e.rel IN (:down_rel_1, :down_rel_2, :down_rel_3, :down_rel_4)
    AND d.depth < :max_depth
    AND d.path NOT LIKE '%|' || e.from_id || '|%'
)
SELECT id, MIN(depth) AS depth
FROM downstream
WHERE id <> :node_id
GROUP BY id
ORDER BY depth, id`;

export const QUERY_UP = `
WITH RECURSIVE upstream(id, depth, path) AS (
  SELECT :node_id, 0, '|' || :node_id || '|'
  UNION ALL
  SELECT e.to_id, u.depth + 1, u.path || e.to_id || '|'
  FROM construct_graph_edges e
  JOIN upstream u ON e.from_id = u.id
  WHERE e.workspace = :workspace
    AND e.state = 'active'
    AND e.rel IN (:up_rel_1, :up_rel_2, :up_rel_3, :up_rel_4)
    AND u.depth < :max_depth
    AND u.path NOT LIKE '%|' || e.to_id || '|%'
)
SELECT id, MIN(depth) AS depth
FROM upstream
WHERE id <> :node_id
GROUP BY id
ORDER BY depth, id`;

export const QUERY_PATH = `
WITH RECURSIVE walk(id, depth, path) AS (
  SELECT :from_node, 0, '|' || :from_node || '|'
  UNION ALL
  SELECT e.to_id, w.depth + 1, w.path || e.to_id || '|'
  FROM construct_graph_edges e
  JOIN walk w ON e.from_id = w.id
  WHERE e.workspace = :workspace
    AND e.state = 'active'
    AND e.rel IN (:path_rel_1, :path_rel_2, :path_rel_3, :path_rel_4)
    AND w.depth < :max_depth
    AND w.path NOT LIKE '%|' || e.to_id || '|%'
)
SELECT path, depth
FROM walk
WHERE id = :to_node
ORDER BY depth
LIMIT 1`;

export const QUERY_CYCLES = `
WITH RECURSIVE reach(root, id, depth, path) AS (
  SELECT n.id, n.id, 0, '|' || n.id || '|'
  FROM construct_graph_nodes n
  WHERE n.workspace = :workspace AND n.lifecycle = 'active'
  UNION ALL
  SELECT r.root, e.to_id, r.depth + 1, r.path || e.to_id || '|'
  FROM construct_graph_edges e
  JOIN reach r ON e.from_id = r.id
  WHERE e.workspace = :workspace
    AND e.state = 'active'
    AND e.rel IN (:cycle_rel_1, :cycle_rel_2, :cycle_rel_3, :cycle_rel_4)
    AND r.depth < :max_depth
    AND (e.to_id = r.root OR r.path NOT LIKE '%|' || e.to_id || '|%')
)
SELECT DISTINCT root AS cycle_member, path AS cycle_path
FROM reach
WHERE id = root AND depth > 0
ORDER BY root`;

export const QUERY_ORPHANS = `
SELECT n.id, n.node_type
FROM construct_graph_nodes n
WHERE n.workspace = :workspace
  AND n.lifecycle = 'active'
  AND NOT EXISTS (
    SELECT 1 FROM construct_graph_edges e
    WHERE e.workspace = n.workspace AND e.from_id = n.id AND e.state = 'active'
  )
  AND NOT EXISTS (
    SELECT 1 FROM construct_graph_edges e
    WHERE e.workspace = n.workspace AND e.to_id = n.id AND e.state = 'active'
  )
ORDER BY n.node_type, n.id`;

export const QUERY_ORPHANED_CAPABILITIES = `
SELECT n.id
FROM construct_graph_nodes n
WHERE n.workspace = :workspace
  AND n.node_type = 'capability'
  AND n.lifecycle = 'active'
  AND NOT EXISTS (
    SELECT 1 FROM construct_graph_edges e
    WHERE e.workspace = n.workspace AND e.to_id = n.id
      AND e.rel IN (:coverage_rel_1, :coverage_rel_2)
      AND e.state = 'active'
  )
ORDER BY n.id`;

export const QUERY_OWNERS = `
SELECT n.id AS node_id, n.owner AS owning_subsystem, e.to_id AS owner_node
FROM construct_graph_nodes n
LEFT JOIN construct_graph_edges e
  ON e.workspace = n.workspace AND e.from_id = n.id
     AND e.rel = :owner_rel AND e.state = 'active'
WHERE n.workspace = :workspace AND n.id = :node_id`;

export const QUERY_REQUIREMENTS = `
SELECT e.to_id AS requirement, e.rel, e.inferred
FROM construct_graph_edges e
WHERE e.workspace = :workspace
  AND e.from_id = :node_id
  AND e.rel IN (:requirement_rel_1, :requirement_rel_2, :requirement_rel_3)
  AND e.state = 'active'
ORDER BY e.rel, e.to_id`;

export const QUERY_IMPACT = `
WITH RECURSIVE dependents(id, depth, path) AS (
  SELECT :changed_id, 0, '|' || :changed_id || '|'
  UNION ALL
  SELECT e.from_id, dpt.depth + 1, dpt.path || e.from_id || '|'
  FROM construct_graph_edges e
  JOIN dependents dpt ON e.to_id = dpt.id
  WHERE e.workspace = :workspace
    AND e.rel = :impact_rel
    AND e.state = 'active'
    AND dpt.depth < :max_depth
    AND dpt.path NOT LIKE '%|' || e.from_id || '|%'
)
SELECT DISTINCT d.id
FROM dependents d
JOIN construct_graph_nodes n
  ON n.workspace = :workspace AND n.id = d.id
WHERE n.node_type = :impact_node_type
ORDER BY d.id`;

export const QUERY_DRIFT = `
SELECT source_name, hash
FROM construct_graph_source_hash
WHERE workspace = :workspace
ORDER BY source_name`;

export const QUERY_EXPLAIN = `
SELECT id, node_type, name, version, lifecycle, source_of_truth_store,
       source_of_truth_ref, owner, rebuild_strategy, confidence, conflict_status,
       provenance_sources, first_observed, last_verified
FROM construct_graph_nodes
WHERE workspace = :workspace AND id = :node_id`;

export const QUERY_EXPORT_EDGES = `
SELECT from_id, rel, to_id, weight, inferred, provenance_sources
FROM construct_graph_edges
WHERE workspace = :workspace AND state = 'active'
ORDER BY from_id, rel, to_id`;

function run(rootDir, sql, params) {
  return withGraphDb(rootDir, (db) => db.prepare(sql).all(params));
}

// Every rel-filtered query template binds a fixed number of :rel_N slots
// (bindNamedParams dedups a name repeated across slots to one positional
// value, so padding past a shorter allowlist by repeating rels[0] costs
// nothing and never widens the actual filter).

function padRelSlots(rels, count) {
  return Array.from({ length: count }, (_, i) => rels[i] ?? rels[0]);
}

// construct-b0nny.12: queryDown/queryUp/queryPath default their rel filter
// away from 'imports' for the same reason DEFAULT_CYCLE_RELS below does —
// 'imports' is dense (52.8% of this repo's own graph's edges) and expected
// to contain cycles/diamonds, and the LIKE-based path-accumulator cycle
// guard cannot dedup a node reached via independent paths. A caller that
// needs a dense relation's transitive closure passes `rels` explicitly (an
// informed, bounded opt-in, not the silent default). DEFAULT_TRAVERSAL_MAX_DEPTH
// matches DEFAULT_CYCLE_MAX_DEPTH's conservative posture as a second,
// independent bound even over the sparse default rels.

const DEFAULT_TRAVERSAL_RELS = ['embeds', 'contains', 'requires', 'owned_by'];
const DEFAULT_TRAVERSAL_MAX_DEPTH = 15;

export function queryDown(rootDir, nodeId, { maxDepth = DEFAULT_TRAVERSAL_MAX_DEPTH, rels = DEFAULT_TRAVERSAL_RELS } = {}) {
  const workspace = resolveGraphWorkspace(rootDir);
  const [r1, r2, r3, r4] = padRelSlots(rels, 4);
  return run(rootDir, QUERY_DOWN, {
    ':node_id': nodeId, ':workspace': workspace, ':max_depth': maxDepth,
    ':down_rel_1': r1, ':down_rel_2': r2, ':down_rel_3': r3, ':down_rel_4': r4,
  });
}

export function queryUp(rootDir, nodeId, { maxDepth = DEFAULT_TRAVERSAL_MAX_DEPTH, rels = DEFAULT_TRAVERSAL_RELS } = {}) {
  const workspace = resolveGraphWorkspace(rootDir);
  const [r1, r2, r3, r4] = padRelSlots(rels, 4);
  return run(rootDir, QUERY_UP, {
    ':node_id': nodeId, ':workspace': workspace, ':max_depth': maxDepth,
    ':up_rel_1': r1, ':up_rel_2': r2, ':up_rel_3': r3, ':up_rel_4': r4,
  });
}

export function queryPath(rootDir, fromNode, toNode, { maxDepth = DEFAULT_TRAVERSAL_MAX_DEPTH, rels = DEFAULT_TRAVERSAL_RELS } = {}) {
  const workspace = resolveGraphWorkspace(rootDir);
  const [r1, r2, r3, r4] = padRelSlots(rels, 4);
  const rows = run(rootDir, QUERY_PATH, {
    ':from_node': fromNode, ':to_node': toNode, ':workspace': workspace, ':max_depth': maxDepth,
    ':path_rel_1': r1, ':path_rel_2': r2, ':path_rel_3': r3, ':path_rel_4': r4,
  });
  if (!rows.length) return null;
  const { path, depth } = rows[0];
  return { depth, chain: path.split('|').filter(Boolean) };
}

// Rels this codebase treats as acyclic-by-intent: embeds (capability-
// >workflow), contains (module->file), requires (provider->tool), owned_by
// (ownership/team membership) — a capability should never embed back to
// itself through its workflow, a module should never contain its own
// container, etc. 'imports' is deliberately excluded from the default:
// unlike the other four it is dense (thousands of edges on this repo's own
// graph) and import cycles are common/expected in real codebases, not a
// "deliberate cycle" in the sense directive §4's milestone means (workflow/
// ownership handoff cycles) — seeding a whole-graph scan from every node
// (cycles' `reach` CTE) over a dense relation caused a real multi-minute
// hang against this repo's own 2.3k-node/6.3k-edge graph during
// construct-b0nny.3 development; scoping the default away from `imports`
// keeps the routine command fast while the wide-relation, deeper-depth scan
// stays available (and expectedly slower) via an explicit --rel.

const DEFAULT_CYCLE_RELS = ['embeds', 'contains', 'requires', 'owned_by'];
const DEFAULT_CYCLE_MAX_DEPTH = 15;

export function queryCycles(rootDir, { rels = DEFAULT_CYCLE_RELS, maxDepth = DEFAULT_CYCLE_MAX_DEPTH } = {}) {
  const workspace = resolveGraphWorkspace(rootDir);
  const [r1, r2, r3, r4] = padRelSlots(rels, 4);
  return run(rootDir, QUERY_CYCLES, {
    ':workspace': workspace, ':max_depth': maxDepth,
    ':cycle_rel_1': r1, ':cycle_rel_2': r2, ':cycle_rel_3': r3, ':cycle_rel_4': r4,
  });
}

export function queryOrphans(rootDir) {
  const workspace = resolveGraphWorkspace(rootDir);
  return run(rootDir, QUERY_ORPHANS, { ':workspace': workspace });
}

// Coverage rels for "orphaned capability": current vocabulary's inbound
// implementation/test edges. 'realizes' (file->capability) and 'validates'
// (test->capability) are what the live seeders actually produce; the design
// doc's original template hardcoded target-ontology names
// ('implements','tested-by','validates','exposes') that do not exist in the
// live edge set yet (see graph-store-design.md §14 correction).

const DEFAULT_COVERAGE_RELS = ['realizes', 'validates'];

export function queryOrphanedCapabilities(rootDir, { rels = DEFAULT_COVERAGE_RELS } = {}) {
  const workspace = resolveGraphWorkspace(rootDir);
  const [r1, r2] = padRelSlots(rels, 2);
  return run(rootDir, QUERY_ORPHANED_CAPABILITIES, { ':workspace': workspace, ':coverage_rel_1': r1, ':coverage_rel_2': r2 });
}

export function queryOwners(rootDir, nodeId, { ownerRel = 'owned_by' } = {}) {
  const workspace = resolveGraphWorkspace(rootDir);
  return run(rootDir, QUERY_OWNERS, { ':workspace': workspace, ':node_id': nodeId, ':owner_rel': ownerRel });
}

// Requirement rels: current vocabulary's closest equivalents to the target
// ontology's depends-on/consumes/implements (imports/uses/realizes).

const DEFAULT_REQUIREMENT_RELS = ['imports', 'uses', 'realizes'];

export function queryRequirements(rootDir, nodeId, { rels = DEFAULT_REQUIREMENT_RELS } = {}) {
  const workspace = resolveGraphWorkspace(rootDir);
  const [r1, r2, r3] = padRelSlots(rels, 3);
  return run(rootDir, QUERY_REQUIREMENTS, { ':workspace': workspace, ':node_id': nodeId, ':requirement_rel_1': r1, ':requirement_rel_2': r2, ':requirement_rel_3': r3 });
}

// construct-b0nny.12: 'imports' (queryImpact's whole purpose — see below) is
// the same dense relation that made queryDown/queryPath hang, so a rel-filter
// default cannot fix queryImpact the way it fixes those three. A 148-importer
// hub in this repo's own graph timed out after 20s even restricted to
// 'imports' alone at the old default maxDepth=50 (spike-a-graph-foundation.md
// "Impact correctness"). 3 is the deepest depth the spike measured as still
// merely slow rather than a hard kill (2038ms unrestricted at depth 3 on this
// repo's own graph; a synthetic hub-scale fixture at comparable density
// measures the same order of magnitude single-rel-restricted, ~1.7s —
// tests/graph/relational-query-latency.test.mjs). Depth 4 on that same
// fixture already took ~9s, so the margin past 3 narrows fast; a caller that
// needs deeper reach on a known non-hub node passes maxDepth explicitly.

const DEFAULT_IMPACT_MAX_DEPTH = 3;

/**
 * Impact CTE (design doc §6/§9): the reverse dependency closure of
 * `changedId` restricted to a node type. `impactRel` defaults to 'imports' —
 * the exact rel impact.mjs's reverseImportClosure traverses — so this ports
 * that closure onto SQL rather than reimplementing a different traversal.
 */
export function queryImpact(rootDir, changedId, { impactRel = 'imports', nodeType = 'test', maxDepth = DEFAULT_IMPACT_MAX_DEPTH } = {}) {
  const workspace = resolveGraphWorkspace(rootDir);
  return run(rootDir, QUERY_IMPACT, {
    ':workspace': workspace, ':changed_id': changedId, ':impact_rel': impactRel,
    ':impact_node_type': nodeType, ':max_depth': maxDepth,
  });
}

export function queryDrift(rootDir) {
  const workspace = resolveGraphWorkspace(rootDir);
  return run(rootDir, QUERY_DRIFT, { ':workspace': workspace });
}

export function queryExplain(rootDir, nodeId) {
  const workspace = resolveGraphWorkspace(rootDir);
  const rows = run(rootDir, QUERY_EXPLAIN, { ':workspace': workspace, ':node_id': nodeId });
  return rows[0] || null;
}

export function queryExportEdges(rootDir) {
  const workspace = resolveGraphWorkspace(rootDir);
  return run(rootDir, QUERY_EXPORT_EDGES, { ':workspace': workspace });
}
