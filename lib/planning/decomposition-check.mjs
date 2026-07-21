/**
 * lib/planning/decomposition-check.mjs — graph-informed decomposition check
 * (construct-b0nny.23), generalizing spike C's proven pattern
 * (docs/notes/research/workspace-control-plane/spikes/c-parallel-software-
 * change/graph-independence-check.sh, synthesized in
 * docs/notes/research/workspace-control-plane/synthesis/spike-c-parallel-
 * software-change.md) into a reusable library function instead of a
 * one-off shell script, per the bead's locked architectural decision:
 * `construct graph` (E1) answers "are these two assignments independent",
 * answered here for a Work spec's own decomposition without re-deriving or
 * replacing the underlying graph queries (lib/graph/relational/queries.mjs's
 * queryDown/queryPath, construct-b0nny.12/.21).
 *
 * Three checks, each named in the bead's own acceptance criteria:
 *   - detectDependencyCycles: cycle detection over the decomposition's own
 *     declared `dependsOn` edges (pure, no I/O) — a Plan whose assignments
 *     form a dependency cycle can never execute (target-model.md concept 7
 *     Enforcement).
 *   - checkDependencyResolution: for every declared dependsOn edge, confirms
 *     a real graph path connects the dependent assignment's touched nodes to
 *     the depended-on assignment's touched nodes — a declared dependency the
 *     graph cannot verify is narrative, not derived (directive §16, quoted in
 *     concept 7: "Bead/Assignment dependencies must derive from the graph,
 *     not narrative intuition").
 *   - checkIndependenceClaims: for every pair of assignments with no declared
 *     dependency, generalizes spike C's exact check — each assignment's
 *     touched nodes' dependents (queryDown, default rel 'imports', matching
 *     spike C's `construct graph query <file>` dependents listing) must have
 *     zero overlap — plus a direct queryPath check in both directions, since
 *     a path between two assignments' touched nodes is itself the "hard
 *     dependency edge" the bead's own text names as what an independence
 *     claim must not share.
 *
 * checkDecomposition composes all three into one report and is what
 * buildWorkSpec attaches to a Work spec's `graphValidation` field.
 */

import { queryDown, queryPath } from '../graph/relational/queries.mjs';

const DEFAULT_INDEPENDENCE_RELS = ['imports'];
const DEFAULT_RESOLUTION_RELS = ['imports'];
const DEFAULT_MAX_DEPTH = 6;

// --- cycle detection over the decomposition's own dependsOn edges ---

function buildDependsOnGraph(decomposition) {
  const adjacency = new Map();
  for (const assignment of decomposition) adjacency.set(assignment.id, assignment.dependsOn ?? []);
  return adjacency;
}

/**
 * DFS with a three-color visit set (white/gray/black) over the
 * decomposition's dependsOn edges. A gray node reached again is a back
 * edge — the cycle is the gray-colored suffix of the current DFS stack.
 *
 * @param {object[]} decomposition - Assignment[]
 * @returns {{ ok: boolean, cycles: string[][] }}
 */
export function detectDependencyCycles(decomposition) {
  const adjacency = buildDependsOnGraph(decomposition);
  const color = new Map();
  const stack = [];
  const cycles = [];

  function visit(id) {
    color.set(id, 'gray');
    stack.push(id);
    for (const dep of adjacency.get(id) ?? []) {
      if (!adjacency.has(dep)) continue;
      const depColor = color.get(dep);
      if (depColor === 'gray') {
        const cycleStart = stack.indexOf(dep);
        cycles.push([...stack.slice(cycleStart), dep]);
      } else if (depColor !== 'black') {
        visit(dep);
      }
    }
    stack.pop();
    color.set(id, 'black');
  }

  for (const assignment of decomposition) {
    if (!color.has(assignment.id)) visit(assignment.id);
  }

  return { ok: cycles.length === 0, cycles };
}

// --- declared-dependency graph resolution ---

function findConnectingPath(rootDir, fromTouches, toTouches, { rels, maxDepth }) {
  for (const fromNode of fromTouches) {
    for (const toNode of toTouches) {
      const path = queryPath(rootDir, fromNode, toNode, { rels, maxDepth });
      if (path) return { from: fromNode, to: toNode, ...path };
    }
  }
  return null;
}

/**
 * For every declared dependsOn edge (assignment A depends on assignment B),
 * confirm a real graph path connects one of A's touched nodes to one of B's
 * touched nodes. An assignment with an empty `touches` array cannot be
 * graph-verified — reported as unresolved with reason 'no-touches' rather
 * than silently skipped.
 *
 * @param {string} rootDir
 * @param {object[]} decomposition - Assignment[]
 * @param {{ rels?: string[], maxDepth?: number }} [opts]
 * @returns {{ ok: boolean, edges: object[] }}
 */
export function checkDependencyResolution(rootDir, decomposition, { rels = DEFAULT_RESOLUTION_RELS, maxDepth = DEFAULT_MAX_DEPTH } = {}) {
  const byId = new Map(decomposition.map((a) => [a.id, a]));
  const edges = [];

  for (const assignment of decomposition) {
    for (const depId of assignment.dependsOn ?? []) {
      const dependency = byId.get(depId);
      if (!dependency) {
        edges.push({ from: assignment.id, to: depId, resolved: false, reason: 'unknown-assignment' });
        continue;
      }
      if ((assignment.touches ?? []).length === 0 || (dependency.touches ?? []).length === 0) {
        edges.push({ from: assignment.id, to: depId, resolved: false, reason: 'no-touches' });
        continue;
      }
      const evidence = findConnectingPath(rootDir, assignment.touches, dependency.touches, { rels, maxDepth });
      edges.push(evidence
        ? { from: assignment.id, to: depId, resolved: true, evidence }
        : { from: assignment.id, to: depId, resolved: false, reason: 'no-graph-path' });
    }
  }

  return { ok: edges.every((e) => e.resolved), edges };
}

// --- independence-claim verification (spike C generalized) ---

function dependentsOfTouches(rootDir, touches, { rels, maxDepth }) {
  const ids = new Set();
  for (const node of touches) {
    for (const row of queryDown(rootDir, node, { rels, maxDepth })) ids.add(row.id);
  }
  return ids;
}

function intersect(setA, setB) {
  const shared = [];
  for (const id of setA) if (setB.has(id)) shared.push(id);
  return shared;
}

/**
 * For every pair of assignments with no declared dependsOn edge (in either
 * direction), verify spike C's proven independence signature: zero overlap
 * between the two assignments' dependents sets. Also checks for a direct
 * graph path between the pair's touched nodes in either direction — a path
 * is a hard dependency edge, which itself falsifies an independence claim
 * even when the dependents sets happen not to overlap.
 *
 * @param {string} rootDir
 * @param {object[]} decomposition - Assignment[]
 * @param {{ rels?: string[], maxDepth?: number }} [opts]
 * @returns {{ ok: boolean, pairs: object[] }}
 */
export function checkIndependenceClaims(rootDir, decomposition, { rels = DEFAULT_INDEPENDENCE_RELS, maxDepth = DEFAULT_MAX_DEPTH } = {}) {
  const declaredEdges = new Set();
  for (const assignment of decomposition) {
    for (const depId of assignment.dependsOn ?? []) {
      declaredEdges.add(`${assignment.id} ${depId}`);
      declaredEdges.add(`${depId} ${assignment.id}`);
    }
  }

  const dependentsCache = new Map();
  function dependentsFor(assignment) {
    if (!dependentsCache.has(assignment.id)) {
      dependentsCache.set(assignment.id, dependentsOfTouches(rootDir, assignment.touches ?? [], { rels, maxDepth }));
    }
    return dependentsCache.get(assignment.id);
  }

  const pairs = [];
  for (let i = 0; i < decomposition.length; i++) {
    for (let j = i + 1; j < decomposition.length; j++) {
      const a = decomposition[i];
      const b = decomposition[j];
      if (declaredEdges.has(`${a.id} ${b.id}`)) continue;

      const sharedDependents = intersect(dependentsFor(a), dependentsFor(b));
      const directPath = (a.touches?.length && b.touches?.length)
        ? (findConnectingPath(rootDir, a.touches, b.touches, { rels, maxDepth }) || findConnectingPath(rootDir, b.touches, a.touches, { rels, maxDepth }))
        : null;

      pairs.push({
        a: a.id,
        b: b.id,
        independent: sharedDependents.length === 0 && !directPath,
        sharedDependents,
        directPath,
      });
    }
  }

  return { ok: pairs.every((p) => p.independent), pairs };
}

/**
 * Run all three graph-informed checks against a Work spec's decomposition
 * and return one consolidated report (attached to a Work spec's
 * `graphValidation` field by buildWorkSpec).
 *
 * @param {string} rootDir
 * @param {object} workSpec
 * @param {{ rels?: string[], maxDepth?: number }} [opts]
 * @returns {{ ok: boolean, cycles: object, dependencyResolution: object, independence: object, checkedAt: string }}
 */
export function checkDecomposition(rootDir, workSpec, opts = {}) {
  const decomposition = workSpec?.decomposition ?? [];
  const cycles = detectDependencyCycles(decomposition);
  const dependencyResolution = checkDependencyResolution(rootDir, decomposition, opts);
  const independence = checkIndependenceClaims(rootDir, decomposition, opts);

  return {
    ok: cycles.ok && dependencyResolution.ok && independence.ok,
    cycles,
    dependencyResolution,
    independence,
    checkedAt: new Date().toISOString(),
  };
}
