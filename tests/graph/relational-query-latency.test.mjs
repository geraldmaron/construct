/**
 * tests/graph/relational-query-latency.test.mjs — hub-scale latency
 * regression pin for lib/graph/relational/queries.mjs (construct-b0nny.12).
 *
 * construct-b0nny.5.1 (spike A, docs/notes/research/workspace-control-plane/
 * synthesis/spike-a-graph-foundation.md) found queryDown/queryPath/queryImpact
 * shared one uncapped, no-rel-filter recursive CTE that went from 2s at depth
 * 3 to a 12-30s hard kill at depth 5+ (or at a real 148-importer hub's
 * default-depth impact query) on this repo's own graph, where 'imports' is
 * 52.8% of all edges. The synthetic fixture below reproduces that shape at a
 * comparable scale (deliberately denser than the real repo's 52.8%, as a
 * worst-case pin rather than an average-case one) without depending on this
 * repo's own source tree, so the pin does not drift as the real repo grows:
 * a "hub" node with a layered fan-in of 'imports' edges (each layer's nodes
 * import several nodes from the previous layer, so the same descendant is
 * reachable via many independent paths — the diamond-reachability pattern
 * that makes the CTE's per-path, non-deduped row accumulation blow up
 * combinatorially with depth) plus filler nodes to reach a comparable total
 * node/edge count to the real repo's measured graph.
 *
 * Pins two things: (1) the new default rel filter (queryDown/queryUp/
 * queryPath) keeps a call with no options fast even when the loaded graph's
 * 'imports' relation is this dense, because 'imports' is excluded by
 * default; (2) queryImpact — which cannot exclude 'imports', that is its
 * whole purpose — stays bounded at hub scale because DEFAULT_IMPACT_MAX_DEPTH
 * caps it, and still returns the correct transitively-reachable result set,
 * not just "fast because empty."
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { writeGraph } from '../../lib/graph/relational/sqlite-store.mjs';
import { queryDown, queryUp, queryPath, queryImpact } from '../../lib/graph/relational/queries.mjs';

// construct-b0nny.3: the relational graph store resolves graph.db under the
// machine-scoped state root (resolveStateDir, ADR-0066). Pin CX_HOME_OVERRIDE
// so this suite never provisions state under the real developer machine's
// ~/.construct/projects/ — the same pattern tests/graph/store.test.mjs and
// tests/graph/cli.test.mjs already established.

const cxHomeOverride = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-graph-latency-home-'));
const prevHomeOverride = process.env.CX_HOME_OVERRIDE;
process.env.CX_HOME_OVERRIDE = cxHomeOverride;
test.after(() => {
  try { fs.rmSync(cxHomeOverride, { recursive: true, force: true }); } catch {}
  if (prevHomeOverride === undefined) delete process.env.CX_HOME_OVERRIDE;
  else process.env.CX_HOME_OVERRIDE = prevHomeOverride;
});

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'graph-latency-'));
after(() => { try { fs.rmSync(root, { recursive: true, force: true }); } catch {} });

// Layered fan-in 'imports' web: LEVELS layers of WIDTH nodes each, layer 1
// imports the hub directly, every later layer's node imports FAN nodes from
// the previous layer (a modular, deterministic choice — not a full bipartite
// — so edge count stays linear in WIDTH*FAN while path count still grows
// combinatorially with depth, the same diamond-reachability shape a dense
// real-world 'imports' relation produces). FAN=5 was picked by measuring
// against this exact fixture until the per-depth latency curve (60ms / 370ms
// / ~2s / ~15-25s at depths 1/2/3/4) matched the spike's real-repo numbers
// (71ms / 493ms / 2038ms / hard-killed) at the same order of magnitude.

const HUB = 'file:synth-hub';
const LEVELS = 6;
const WIDTH = 150;
const FAN = 5;
const FILLER_COUNT = 1300;
const TEST_NODE_COUNT = 60;

function buildHubScaleFixture() {
  const nodes = [{ id: HUB, type: 'file', name: 'synth-hub' }];
  const edges = [];

  const layers = [];
  for (let level = 1; level <= LEVELS; level++) {
    const layer = [];
    for (let i = 0; i < WIDTH; i++) {
      const id = `file:synth-L${level}-${i}`;
      layer.push(id);
      nodes.push({ id, type: 'file', name: id });
    }
    layers.push(layer);
  }

  for (const id of layers[0]) edges.push({ from: id, to: HUB, rel: 'imports' });
  for (let level = 1; level < LEVELS; level++) {
    const prev = layers[level - 1];
    const cur = layers[level];
    for (let i = 0; i < cur.length; i++) {
      for (let f = 0; f < FAN; f++) {
        const targetIdx = (i * FAN + f * 37) % prev.length;
        edges.push({ from: cur[i], to: prev[targetIdx], rel: 'imports' });
      }
    }
  }

  // Test nodes attach to layer 2 (layers[1]) so queryImpact's default
  // reverse-import walk (hub -> layer1 importers -> layer2 importers ->
  // these tests) reaches them at exactly depth 3, matching
  // DEFAULT_IMPACT_MAX_DEPTH — proving the default is deep enough to find a
  // real result, not merely shallow enough to be fast.
  for (let i = 0; i < TEST_NODE_COUNT; i++) {
    const id = `test:synth-test-${i}`;
    nodes.push({ id, type: 'test', name: id });
    edges.push({ from: id, to: layers[1][i % WIDTH], rel: 'imports' });
  }

  // Filler chain: bulks node/edge counts up toward the real repo's measured
  // scale (2,371 nodes / 6,304 edges) without adding more diamond
  // reachability, so table-scan cardinality is comparable without changing
  // the combinatorial-blowup structure under test.
  for (let i = 0; i < FILLER_COUNT; i++) {
    const id = `file:filler-${i}`;
    nodes.push({ id, type: 'file', name: id });
    if (i > 0) edges.push({ from: id, to: `file:filler-${i - 1}`, rel: 'imports' });
  }

  // A sparse, non-'imports' chain the default rel filter (embeds/contains/
  // requires/owned_by) can actually traverse — proves the default isn't just
  // "fast because it finds nothing," it finds real sparse-relation results.
  nodes.push({ id: 'capability:synth-cap', type: 'capability', name: 'synth-cap' });
  nodes.push({ id: 'workflow:synth-wf', type: 'workflow', name: 'synth-wf' });
  edges.push({ from: 'capability:synth-cap', to: 'workflow:synth-wf', rel: 'embeds' });

  return { nodes, edges };
}

function elapsedMs(fn) {
  const t0 = process.hrtime.bigint();
  const result = fn();
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  return { result, ms };
}

const { nodes, edges } = buildHubScaleFixture();
const built = writeGraph(root, { nodes, edges });

test('fixture reaches hub-scale node/edge counts comparable to the real repo graph', () => {
  assert.equal(built.nodeCount, nodes.length);
  assert.ok(built.edgeCount > 5000, `expected a hub-scale edge count, got ${built.edgeCount}`);
});

test('queryDown with default options excludes the dense imports relation and stays fast at hub scale', () => {
  const { result, ms } = elapsedMs(() => queryDown(root, HUB));
  assert.equal(result.length, 0, 'the hub has no inbound edges on any default (non-imports) rel');
  assert.ok(ms < 2000, `queryDown defaults took ${ms.toFixed(1)}ms, expected well under 2000ms`);
});

test('queryDown with default options still finds a real result along a sparse default rel', () => {
  const { result, ms } = elapsedMs(() => queryDown(root, 'workflow:synth-wf'));
  assert.deepEqual(result.map((r) => r.id), ['capability:synth-cap']);
  assert.ok(ms < 2000, `queryDown defaults took ${ms.toFixed(1)}ms, expected well under 2000ms`);
});

test('queryPath with default options finds a sparse-rel path fast', () => {
  const { result, ms } = elapsedMs(() => queryPath(root, 'capability:synth-cap', 'workflow:synth-wf'));
  assert.deepEqual(result, { depth: 1, chain: ['capability:synth-cap', 'workflow:synth-wf'] });
  assert.ok(ms < 2000, `queryPath defaults took ${ms.toFixed(1)}ms, expected well under 2000ms`);
});

test('queryUp with an explicit imports opt-in and a bounded depth still terminates fast at hub scale', () => {
  const { result, ms } = elapsedMs(() => queryUp(root, 'file:synth-L1-0', { rels: ['imports'], maxDepth: 2 }));
  assert.deepEqual(result.map((r) => ({ id: r.id, depth: r.depth })), [{ id: HUB, depth: 1 }]);
  assert.ok(ms < 6000, `queryUp(imports, maxDepth=2) took ${ms.toFixed(1)}ms, expected under 6000ms`);
});

test('queryPath with an explicit imports opt-in and a bounded depth still terminates fast at hub scale', () => {
  const { result, ms } = elapsedMs(() => queryPath(root, 'file:synth-L2-0', HUB, { rels: ['imports'], maxDepth: 3 }));
  assert.equal(result.depth, 2);
  assert.deepEqual(result.chain, ['file:synth-L2-0', 'file:synth-L1-0', HUB]);
  assert.ok(ms < 6000, `queryPath(imports, maxDepth=3) took ${ms.toFixed(1)}ms, expected under 6000ms`);
});

test('queryDown with an explicit imports opt-in and a bounded depth still terminates at hub scale (was a 12-30s hard kill before the fix)', () => {
  const { result, ms } = elapsedMs(() => queryDown(root, HUB, { rels: ['imports'], maxDepth: 3 }));
  assert.ok(result.length > 0, 'the dense imports fan-in is reachable when explicitly opted into');
  assert.ok(ms < 8000, `queryDown(imports, maxDepth=3) took ${ms.toFixed(1)}ms, expected under 8000ms`);
});

test('queryImpact with default options (impactRel defaults to imports) stays bounded and finds the real reachable test set at hub scale', () => {
  const { result, ms } = elapsedMs(() => queryImpact(root, HUB));
  assert.equal(result.length, TEST_NODE_COUNT, 'every synthetic test node attached at depth 3 is found');
  assert.deepEqual(result.map((r) => r.id).sort(), Array.from({ length: TEST_NODE_COUNT }, (_, i) => `test:synth-test-${i}`).sort());
  assert.ok(ms < 8000, `queryImpact defaults took ${ms.toFixed(1)}ms, expected under 8000ms (was a 20s+ hard kill on a real 148-importer hub before the fix)`);
});
