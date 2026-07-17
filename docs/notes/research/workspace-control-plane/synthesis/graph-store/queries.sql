/*
 * queries.sql — portable query templates for the workspace-control-plane graph
 * store (design artifact for construct-b0nny.2). Each statement is a parameterized
 * template; :workspace, :node_id, :max_depth, etc. are bound by the store layer
 * (node:sqlite binds :name natively; the Postgres client maps :name to $n).
 *
 * Every statement runs UNCHANGED on both ddl-sqlite.sql and ddl-postgres.sql:
 * traversal uses WITH RECURSIVE (both backends), a TEXT path accumulator, and a
 * LIKE-based cycle guard rather than Postgres arrays or backend-specific
 * functions (instr vs strpos, group_concat vs string_agg are avoided). This is
 * what lets a parity harness assert byte-equal result sets (directive §4 day-one
 * milestone: "equivalent results on SQLite and Postgres"). Aggregation of
 * multi-row results (e.g. collecting a node's owners) happens in the store layer,
 * not in SQL, to keep the text portable.
 *
 * These templates back the directive §4.8 command surface (build/update/validate/
 * query/impact/path/owners/requirements/orphans/cycles/drift/explain/export). The
 * bounded-depth guard (:max_depth) implements the directive's "first-order and
 * bounded transitive dependents".
 *
 * CORRECTION (construct-b0nny.3 build, 2026-07-17): the impact/requirements/
 * orphaned-capability/owners templates below originally hardcoded target-
 * ontology rel literals ('depends-on', 'consumes', 'implements', 'tested-by',
 * 'owned-by' hyphenated) as SQL string literals rather than bind parameters.
 * The b0nny.3 build ports the *existing* 16-relation vocabulary (imports,
 * uses, realizes, validates, owned_by underscored, …) onto this schema — the
 * ontology rename to the ~30 target edge types (design doc §8.2) is not part
 * of this build, so those literal target-ontology names never match any edge
 * the live seeders actually produce, and every one of these four queries
 * would silently return zero rows against real data. Fixed by parameterizing
 * the rel filter in each (:impact_rel, :requirement_rel_N, :coverage_rel_N,
 * :owner_rel) so the caller binds whatever vocabulary is live — portable
 * (plain `IN (:a,:b)` / `= :x`, no backend-specific functions) either way.
 * See lib/graph/relational/queries.mjs for the parameterized versions and
 * their current-vocabulary default bindings.
 */

-- QUERY down (dependents / impact direction): nodes that transitively point AT
-- :node_id, i.e. what is affected if :node_id changes. Reverse traversal along
-- edges (e.to_id = frontier). Ports store.mjs dependentsOf to a recursive CTE.

WITH RECURSIVE downstream(id, depth, path) AS (
  SELECT :node_id, 0, '|' || :node_id || '|'
  UNION ALL
  SELECT e.from_id, d.depth + 1, d.path || e.from_id || '|'
  FROM construct_graph_edges e
  JOIN downstream d ON e.to_id = d.id
  WHERE e.workspace = :workspace
    AND e.state = 'active'
    AND d.depth < :max_depth
    AND d.path NOT LIKE '%|' || e.from_id || '|%'
)
SELECT id, MIN(depth) AS depth
FROM downstream
WHERE id <> :node_id
GROUP BY id
ORDER BY depth, id;

-- QUERY up (dependencies): nodes :node_id transitively points TO. Forward
-- traversal (e.from_id = frontier). Ports store.mjs dependenciesOf.

WITH RECURSIVE upstream(id, depth, path) AS (
  SELECT :node_id, 0, '|' || :node_id || '|'
  UNION ALL
  SELECT e.to_id, u.depth + 1, u.path || e.to_id || '|'
  FROM construct_graph_edges e
  JOIN upstream u ON e.from_id = u.id
  WHERE e.workspace = :workspace
    AND e.state = 'active'
    AND u.depth < :max_depth
    AND u.path NOT LIKE '%|' || e.to_id || '|%'
)
SELECT id, MIN(depth) AS depth
FROM upstream
WHERE id <> :node_id
GROUP BY id
ORDER BY depth, id;

-- QUERY path: shortest directed path (fewest hops) from :from_node to :to_node.
-- The path accumulator doubles as the returned human-readable chain.

WITH RECURSIVE walk(id, depth, path) AS (
  SELECT :from_node, 0, '|' || :from_node || '|'
  UNION ALL
  SELECT e.to_id, w.depth + 1, w.path || e.to_id || '|'
  FROM construct_graph_edges e
  JOIN walk w ON e.from_id = w.id
  WHERE e.workspace = :workspace
    AND e.state = 'active'
    AND w.depth < :max_depth
    AND w.path NOT LIKE '%|' || e.to_id || '|%'
)
SELECT path, depth
FROM walk
WHERE id = :to_node
ORDER BY depth
LIMIT 1;

-- QUERY cycles: relation-scoped cycle detection. Seeds from every active node and
-- reports a return to its own root along the scoped relations. Restricting to the
-- acyclic-by-intent relation set (:cycle_rel_1.. e.g. depends-on, contains,
-- imports, executed-by) bounds the traversal cost; whole-graph cycle scans are a
-- Spike-A latency measurement, not a routine query.

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
ORDER BY root;

-- QUERY orphans (structural): active nodes with neither an active inbound nor an
-- active outbound edge.

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
ORDER BY n.node_type, n.id;

-- QUERY orphaned capability (typed): a capability with no inbound implementation,
-- test, or exposure edge — the directive day-one "detect an orphaned capability".

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
ORDER BY n.id;

-- QUERY owners: the owning subsystem field plus each owned-by target as its own
-- row (store-layer aggregates; SQL stays parity-portable, no group_concat).

SELECT n.id AS node_id, n.owner AS owning_subsystem, e.to_id AS owner_node
FROM construct_graph_nodes n
LEFT JOIN construct_graph_edges e
  ON e.workspace = n.workspace AND e.from_id = n.id
     AND e.rel = :owner_rel AND e.state = 'active'
WHERE n.workspace = :workspace AND n.id = :node_id;

-- QUERY requirements (direct): the declared/discovered requirements of :node_id
-- along the dependency relations; the transitive form is the `up` template with
-- an e.rel filter.

SELECT e.to_id AS requirement, e.rel, e.inferred
FROM construct_graph_edges e
WHERE e.workspace = :workspace
  AND e.from_id = :node_id
  AND e.rel IN (:requirement_rel_1, :requirement_rel_2, :requirement_rel_3)
  AND e.state = 'active'
ORDER BY e.rel, e.to_id;

-- QUERY impact (affected tests): the reverse dependency closure of :changed_id
-- restricted to test endpoints. Ports lib/graph/impact.mjs reverseImportClosure +
-- test selection onto a recursive CTE. Capability/contract/schema impact reuses
-- the same closure with a node_type filter in the final SELECT.

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
ORDER BY d.id;

-- QUERY drift (stored side): the per-source hashes recorded at last build. The
-- store layer recomputes the live hashes (lib/graph/staleness.mjs computeSourceHashes)
-- and diffs; a mismatch names the drifted source.

SELECT source_name, hash
FROM construct_graph_source_hash
WHERE workspace = :workspace
ORDER BY source_name;

-- QUERY explain: a node with its full provenance and lifecycle metadata for the
-- `explain` command; edges are fetched separately with the up/down templates.

SELECT id, node_type, name, version, lifecycle, source_of_truth_store,
       source_of_truth_ref, owner, rebuild_strategy, confidence, conflict_status,
       provenance_sources, first_observed, last_verified
FROM construct_graph_nodes
WHERE workspace = :workspace AND id = :node_id;

-- QUERY export (edges): active edges in deterministic order for JSON export and
-- for rendering a mermaid/DOT diagram in the store layer. The nodes export is the
-- same shape over construct_graph_nodes.

SELECT from_id, rel, to_id, weight, inferred, provenance_sources
FROM construct_graph_edges
WHERE workspace = :workspace AND state = 'active'
ORDER BY from_id, rel, to_id;

-- QUERY outbox drain: claim the next pending/failed events for the incremental
-- applier in commit order. The applier applies each payload to the node/edge
-- tables and appends to construct_graph_applied_log in the same transaction.

SELECT outbox_id, event_type, payload, origin, declared, attempt
FROM construct_graph_outbox
WHERE workspace = :workspace AND status IN ('pending', 'failed')
ORDER BY outbox_id
LIMIT :batch_size;

-- QUERY applied-log gap check: the max applied seq and the applied count. If
-- max(seq) exceeds count(*) (after accounting for the first seq), an event was
-- lost and the reconciliation decision forces a full rebuild.

SELECT MIN(seq) AS min_seq, MAX(seq) AS max_seq, COUNT(*) AS applied_count
FROM construct_graph_applied_log
WHERE workspace = :workspace;
