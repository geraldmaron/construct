/**
 * tests/graph/relational-postgres-store.test.mjs — Postgres graph store
 * including the live cross-backend
 * query-template parity proof.
 *
 * bindNamedParams is pure JS and always runs (no network) — it pins the
 * :name -> $n rewrite the day-one milestone's "equivalent results on SQLite
 * and Postgres" claim depends on. The PostgresGraphStore round-trip and the
 * query-template parity suite below both gate on createSqlClient(env) being
 * non-null: with no DATABASE_URL (the default CI and local posture) a single
 * passing test records the skip, matching tests/orchestration-run-store-
 * postgres.test.mjs's established pattern.
 *
 * Ran this file for real against a live Docker Postgres
 * instance (see the bead's closing report for the run transcript) and added
 * the "query-template parity" suite: the exact recursive-CTE SQL text from
 * queries.mjs (queryUp/queryDown/path/cycles/orphans/orphaned-capabilities/
 * owners/requirements/impact — the engine behind day-one milestones 4-8) run
 * unmodified against Postgres via bindNamedParams + sql.unsafe, on the same
 * fixture also loaded into SQLite through the exported queryX wrapper
 * functions, and the row sets are asserted equal. This is genuine live
 * evidence for the query surface; it does not prove the spawned `construct`
 * binary itself can run graph-store commands against a Postgres-backed
 * store — the CLI's storage layer (lib/graph/relational/queries.mjs's `run`
 * helper, outbox.mjs, reconcile.mjs) is synchronous and wired to node:sqlite
 * only, with no backend-switching on DATABASE_URL. Wiring that switch is a
 * separate, larger change (this bead's non-goals rule out redesigning the
 * store) — tracked as a gap in the bead's closing report, not silently
 * papered over.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createSqlClient, closeSqlClient } from '../../lib/storage/backend.mjs';
import { PostgresGraphStore, bindNamedParams } from '../../lib/graph/relational/postgres-store.mjs';
import { writeGraph as writeSqliteGraph } from '../../lib/graph/relational/sqlite-store.mjs';
import {
  QUERY_UP, QUERY_DOWN, QUERY_PATH, QUERY_CYCLES, QUERY_ORPHANS,
  QUERY_ORPHANED_CAPABILITIES, QUERY_OWNERS, QUERY_REQUIREMENTS, QUERY_IMPACT,
  queryUp, queryDown, queryPath, queryCycles, queryOrphans,
  queryOrphanedCapabilities, queryOwners, queryRequirements, queryImpact,
} from '../../lib/graph/relational/queries.mjs';

test('bindNamedParams rewrites :name placeholders to positional $n in first-appearance order', () => {
  const { text, values } = bindNamedParams(
    'SELECT * FROM t WHERE workspace = :workspace AND id = :id',
    { ':workspace': 'ws1', ':id': 'node:a' },
  );
  assert.equal(text, 'SELECT * FROM t WHERE workspace = $1 AND id = $2');
  assert.deepEqual(values, ['ws1', 'node:a']);
});

test('bindNamedParams reuses one slot for a name repeated in the template', () => {
  const { text, values } = bindNamedParams(QUERY_UP, {
    ':node_id': 'file:a', ':workspace': 'ws1', ':max_depth': 10,
    ':up_rel_1': 'embeds', ':up_rel_2': 'contains', ':up_rel_3': 'requires', ':up_rel_4': 'owned_by',
  });
  // :node_id appears twice in QUERY_UP (seed + final WHERE); both occurrences
  // must resolve to the same $n, not allocate a second positional slot.
  const nodeIdSlot = text.match(/\$(\d+)/)[1];
  const occurrences = [...text.matchAll(new RegExp(`\\$${nodeIdSlot}(?!\\d)`, 'g'))];
  assert.ok(occurrences.length >= 2, ':node_id should map to the same $n at every occurrence');
  assert.equal(values.length, 7, 'exactly 7 distinct named params in QUERY_UP (node_id, workspace, max_depth, up_rel_1..4)');
});

test('bindNamedParams handles the 4-slot cycles template', () => {
  const { text, values } = bindNamedParams(QUERY_CYCLES, {
    ':workspace': 'ws1', ':max_depth': 15,
    ':cycle_rel_1': 'embeds', ':cycle_rel_2': 'contains', ':cycle_rel_3': 'requires', ':cycle_rel_4': 'owned_by',
  });
  assert.equal(values.length, 6);
  assert.ok(!text.includes(':'), 'no named placeholders remain');
});

const sql = createSqlClient(process.env);

if (!sql) {
  test('postgres graph store skipped — no DATABASE_URL / sql client', () => {
    assert.equal(createSqlClient(process.env), null);
  });

  test('constructor rejects a missing sql client or workspace', () => {
    assert.throws(() => new PostgresGraphStore({ workspace: 'ws1' }), /sql client is required/);
    assert.throws(() => new PostgresGraphStore({ sql: {} }), /workspace is required/);
  });
} else {
  // node:test runs multiple top-level test.after() hooks in registration
  // (FIFO) order, not LIFO — closeSqlClient is registered last, at the very
  // end of this block, so every other after-hook that still needs `sql`
  // (including the parity suite's row cleanup below) runs before the
  // connection closes.

  test('writeGraph/loadGraph round-trip through Postgres', async () => {
    const workspace = `cx-test-graph-${Date.now()}`;
    const store = new PostgresGraphStore({ sql, workspace });
    await store.ensureSchema();
    await store.writeGraph({
      nodes: [{ id: 'capability:a', type: 'capability', name: 'A', attrs: { criticality: 'P0' } }],
      edges: [],
      generatedAt: new Date().toISOString(),
      sourceHash: 'abc',
    });
    const graph = await store.loadGraph();
    assert.equal(graph.exists, true);
    assert.equal(graph.nodes.size, 1);
    assert.equal(graph.nodes.get('capability:a').attrs.criticality, 'P0');
    await sql`DELETE FROM construct_graph_nodes WHERE workspace = ${workspace}`;
    await sql`DELETE FROM construct_graph_meta WHERE workspace = ${workspace}`;
  });

  // --- Live query-template parity, SQLite vs Postgres ---

  // resolveStateDir keys graph.db off HOME — isolate it the same
  // way tests/graph/relational-query-latency.test.mjs and tests/graph/
  // cli.test.mjs already do, so this suite never touches a real developer
  // machine's ~/.construct/projects/.

  const parityHomeOverride = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-graph-pg-parity-home-'));
  const prevParityHomeOverride = process.env.CONSTRUCT_HOME_OVERRIDE;
  process.env.CONSTRUCT_HOME_OVERRIDE = parityHomeOverride;

  const parityRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'graph-pg-parity-'));
  const PARITY_WORKSPACE = `cx-test-graph-parity-${Date.now()}`;

  // One fixture, shared by every template comparison below, covering the
  // rel/ontology shapes each query template exists to answer: a two-hop
  // embeds chain (up/down/path), a deliberate embeds cycle, an edgeless
  // node (orphans), an untested capability vs. one with an inbound
  // `validates` edge (orphaned-capabilities), an owned_by edge (owners), an
  // imports edge (requirements), and an imports chain reaching both a test
  // and a provider (impact) — the same node-type vocabulary
  // tests/functional/graph-relational-store.functional.test.mjs's milestones
  // 4-8 exercise, run here against a live backend instead of the CLI.

  function buildParityFixture() {
    return {
      nodes: [
        { id: 'capability:parity-a', type: 'capability' },
        { id: 'workflow:parity-b', type: 'workflow' },
        { id: 'workflow:parity-c', type: 'workflow' },
        { id: 'capability:parity-orphan', type: 'capability' },
        { id: 'capability:parity-uncovered', type: 'capability' },
        { id: 'capability:parity-covered', type: 'capability' },
        { id: 'test:parity-test', type: 'test' },
        { id: 'capability:parity-cycle-a', type: 'capability' },
        { id: 'workflow:parity-cycle-b', type: 'workflow' },
        { id: 'specialist:parity-owner', type: 'specialist' },
        { id: 'capability:parity-owned', type: 'capability' },
        { id: 'capability:parity-req', type: 'capability' },
        { id: 'file:parity-dep', type: 'file' },
        { id: 'schema:parity-schema', type: 'schema' },
        { id: 'test:parity-impact-test', type: 'test' },
        { id: 'provider:parity-adapter', type: 'provider' },
      ],
      edges: [
        { from: 'capability:parity-a', to: 'workflow:parity-b', rel: 'embeds' },
        { from: 'workflow:parity-b', to: 'workflow:parity-c', rel: 'embeds' },
        { from: 'test:parity-test', to: 'capability:parity-covered', rel: 'validates' },
        { from: 'capability:parity-cycle-a', to: 'workflow:parity-cycle-b', rel: 'embeds' },
        { from: 'workflow:parity-cycle-b', to: 'capability:parity-cycle-a', rel: 'embeds' },
        { from: 'capability:parity-owned', to: 'specialist:parity-owner', rel: 'owned_by' },
        { from: 'capability:parity-req', to: 'file:parity-dep', rel: 'imports' },
        { from: 'test:parity-impact-test', to: 'schema:parity-schema', rel: 'imports' },
        { from: 'provider:parity-adapter', to: 'test:parity-impact-test', rel: 'imports' },
      ],
    };
  }

  const parityFixture = buildParityFixture();
  writeSqliteGraph(parityRoot, parityFixture);

  const parityStore = new PostgresGraphStore({ sql, workspace: PARITY_WORKSPACE });

  test.after(async () => {
    if (prevParityHomeOverride === undefined) delete process.env.CONSTRUCT_HOME_OVERRIDE;
    else process.env.CONSTRUCT_HOME_OVERRIDE = prevParityHomeOverride;
    try { fs.rmSync(parityHomeOverride, { recursive: true, force: true }); } catch {}
    try { fs.rmSync(parityRoot, { recursive: true, force: true }); } catch {}
    await sql`DELETE FROM construct_graph_nodes WHERE workspace = ${PARITY_WORKSPACE}`;
    await sql`DELETE FROM construct_graph_edges WHERE workspace = ${PARITY_WORKSPACE}`;
    await sql`DELETE FROM construct_graph_meta WHERE workspace = ${PARITY_WORKSPACE}`;
  });

  test('parity setup: fixture loads into both backends', async () => {
    await parityStore.ensureSchema();
    const written = await parityStore.writeGraph(parityFixture);
    assert.equal(written.nodeCount, parityFixture.nodes.length);
    assert.equal(written.edgeCount, parityFixture.edges.length);
  });

  // padRelSlots mirrors queries.mjs's private helper of the same purpose
  // (short-of-4 rel lists repeat rels[0] into the unused slots) — duplicated
  // here rather than exported since it is an internal template-binding
  // detail, not part of the queries.mjs public surface.

  function padRelSlots(rels, count) {
    return Array.from({ length: count }, (_, i) => rels[i] ?? rels[0]);
  }

  async function runPgQuery(template, params) {
    return [...(await parityStore.runQuery(template, params))];
  }

  // node:sqlite's .all() returns rows with a null prototype; the postgres
  // driver returns plain objects. assert.deepEqual (strict) treats those as
  // unequal even with identical own-enumerable properties, so both sides are
  // normalized through the same plain-object mapper before comparing — a
  // JS-driver artifact, not a real cross-backend content difference.

  function plainRows(rows, pick) {
    return rows.map((r) => pick(r));
  }

  test('parity: queryUp matches between SQLite and live Postgres', async () => {
    const rels = ['embeds', 'contains', 'requires', 'owned_by'];
    const sqliteRows = queryUp(parityRoot, 'capability:parity-a', { rels, maxDepth: 15 });
    const [r1, r2, r3, r4] = padRelSlots(rels, 4);
    const pgRows = await runPgQuery(QUERY_UP, {
      ':node_id': 'capability:parity-a', ':workspace': PARITY_WORKSPACE, ':max_depth': 15,
      ':up_rel_1': r1, ':up_rel_2': r2, ':up_rel_3': r3, ':up_rel_4': r4,
    });
    const pick = (r) => ({ id: r.id, depth: Number(r.depth) });
    assert.deepEqual(plainRows(pgRows, pick), plainRows(sqliteRows, pick));
    assert.deepEqual(sqliteRows.map((r) => r.id), ['workflow:parity-b', 'workflow:parity-c']);
  });

  test('parity: queryDown matches between SQLite and live Postgres', async () => {
    const rels = ['embeds', 'contains', 'requires', 'owned_by'];
    const sqliteRows = queryDown(parityRoot, 'workflow:parity-c', { rels, maxDepth: 15 });
    const [r1, r2, r3, r4] = padRelSlots(rels, 4);
    const pgRows = await runPgQuery(QUERY_DOWN, {
      ':node_id': 'workflow:parity-c', ':workspace': PARITY_WORKSPACE, ':max_depth': 15,
      ':down_rel_1': r1, ':down_rel_2': r2, ':down_rel_3': r3, ':down_rel_4': r4,
    });
    const pick = (r) => ({ id: r.id, depth: Number(r.depth) });
    assert.deepEqual(plainRows(pgRows, pick), plainRows(sqliteRows, pick));
    assert.deepEqual(sqliteRows.map((r) => r.id), ['workflow:parity-b', 'capability:parity-a']);
  });

  test('parity: path matches between SQLite and live Postgres', async () => {
    const rels = ['embeds', 'contains', 'requires', 'owned_by'];
    const sqliteResult = queryPath(parityRoot, 'capability:parity-a', 'workflow:parity-c', { rels, maxDepth: 15 });
    const [r1, r2, r3, r4] = padRelSlots(rels, 4);
    const pgRows = await runPgQuery(QUERY_PATH, {
      ':from_node': 'capability:parity-a', ':to_node': 'workflow:parity-c', ':workspace': PARITY_WORKSPACE, ':max_depth': 15,
      ':path_rel_1': r1, ':path_rel_2': r2, ':path_rel_3': r3, ':path_rel_4': r4,
    });
    assert.equal(pgRows.length, 1);
    const pgResult = { depth: Number(pgRows[0].depth), chain: pgRows[0].path.split('|').filter(Boolean) };
    assert.deepEqual(pgResult, sqliteResult);
    assert.deepEqual(sqliteResult, { depth: 2, chain: ['capability:parity-a', 'workflow:parity-b', 'workflow:parity-c'] });
  });

  test('parity: cycles matches between SQLite and live Postgres', async () => {
    const rels = ['embeds', 'contains', 'requires', 'owned_by'];
    const sqliteRows = queryCycles(parityRoot, { rels, maxDepth: 15 });
    const [r1, r2, r3, r4] = padRelSlots(rels, 4);
    const pgRows = await runPgQuery(QUERY_CYCLES, {
      ':workspace': PARITY_WORKSPACE, ':max_depth': 15,
      ':cycle_rel_1': r1, ':cycle_rel_2': r2, ':cycle_rel_3': r3, ':cycle_rel_4': r4,
    });
    const pick = (r) => ({ cycle_member: r.cycle_member, cycle_path: r.cycle_path });
    assert.deepEqual(plainRows(pgRows, pick), plainRows(sqliteRows, pick));
    assert.deepEqual(sqliteRows.map((r) => r.cycle_member).sort(), ['capability:parity-cycle-a', 'workflow:parity-cycle-b']);
  });

  test('parity: orphans matches between SQLite and live Postgres', async () => {
    const sqliteRows = queryOrphans(parityRoot);
    const pgRows = await runPgQuery(QUERY_ORPHANS, { ':workspace': PARITY_WORKSPACE });
    const pick = (r) => ({ id: r.id, node_type: r.node_type });
    assert.deepEqual(plainRows(pgRows, pick), plainRows(sqliteRows, pick));
    assert.ok(sqliteRows.some((r) => r.id === 'capability:parity-orphan'));
  });

  test('parity: orphaned-capabilities matches between SQLite and live Postgres', async () => {
    const rels = ['realizes', 'validates'];
    const sqliteRows = queryOrphanedCapabilities(parityRoot, { rels });
    const [r1, r2] = padRelSlots(rels, 2);
    const pgRows = await runPgQuery(QUERY_ORPHANED_CAPABILITIES, { ':workspace': PARITY_WORKSPACE, ':coverage_rel_1': r1, ':coverage_rel_2': r2 });
    const pick = (r) => ({ id: r.id });
    assert.deepEqual(plainRows(pgRows, pick), plainRows(sqliteRows, pick));
    const ids = sqliteRows.map((r) => r.id);
    assert.ok(ids.includes('capability:parity-uncovered'));
    assert.ok(!ids.includes('capability:parity-covered'), 'the validated capability must not be reported orphaned');
  });

  test('parity: owners matches between SQLite and live Postgres', async () => {
    const sqliteRows = queryOwners(parityRoot, 'capability:parity-owned', { ownerRel: 'owned_by' });
    const pgRows = await runPgQuery(QUERY_OWNERS, { ':workspace': PARITY_WORKSPACE, ':node_id': 'capability:parity-owned', ':owner_rel': 'owned_by' });
    const pick = (r) => ({ node_id: r.node_id, owning_subsystem: r.owning_subsystem, owner_node: r.owner_node });
    assert.deepEqual(plainRows(pgRows, pick), plainRows(sqliteRows, pick));
    assert.deepEqual(sqliteRows.map((r) => r.owner_node), ['specialist:parity-owner']);
  });

  test('parity: requirements matches between SQLite and live Postgres', async () => {
    const rels = ['imports', 'uses', 'realizes'];
    const sqliteRows = queryRequirements(parityRoot, 'capability:parity-req', { rels });
    const [r1, r2, r3] = padRelSlots(rels, 3);
    const pgRows = await runPgQuery(QUERY_REQUIREMENTS, {
      ':workspace': PARITY_WORKSPACE, ':node_id': 'capability:parity-req',
      ':requirement_rel_1': r1, ':requirement_rel_2': r2, ':requirement_rel_3': r3,
    });
    const pick = (r) => ({ requirement: r.requirement, rel: r.rel, inferred: !!r.inferred });
    assert.deepEqual(plainRows(pgRows, pick), plainRows(sqliteRows, pick));
    assert.deepEqual(sqliteRows.map((r) => r.requirement), ['file:parity-dep']);
  });

  test('parity: impact matches between SQLite and live Postgres, for both node-type filters', async () => {
    const pick = (r) => ({ id: r.id });
    const sqliteTests = queryImpact(parityRoot, 'schema:parity-schema', { impactRel: 'imports', nodeType: 'test', maxDepth: 3 });
    const pgTests = await runPgQuery(QUERY_IMPACT, {
      ':workspace': PARITY_WORKSPACE, ':changed_id': 'schema:parity-schema', ':impact_rel': 'imports',
      ':impact_node_type': 'test', ':max_depth': 3,
    });
    assert.deepEqual(plainRows(pgTests, pick), plainRows(sqliteTests, pick));
    assert.deepEqual(sqliteTests.map((r) => r.id), ['test:parity-impact-test']);

    const sqliteProviders = queryImpact(parityRoot, 'schema:parity-schema', { impactRel: 'imports', nodeType: 'provider', maxDepth: 3 });
    const pgProviders = await runPgQuery(QUERY_IMPACT, {
      ':workspace': PARITY_WORKSPACE, ':changed_id': 'schema:parity-schema', ':impact_rel': 'imports',
      ':impact_node_type': 'provider', ':max_depth': 3,
    });
    assert.deepEqual(plainRows(pgProviders, pick), plainRows(sqliteProviders, pick));
    assert.deepEqual(sqliteProviders.map((r) => r.id), ['provider:parity-adapter']);
  });

  // Registered last so it runs last (see the FIFO note above) — every prior
  // after-hook in this block still has a live connection when it runs.

  test.after(async () => { await closeSqlClient(sql); });
}
