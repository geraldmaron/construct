/**
 * tests/graph/relational-postgres-store.test.mjs — Postgres graph store
 * (construct-b0nny.3).
 *
 * bindNamedParams is pure JS and always runs (no network) — it pins the
 * :name -> $n rewrite the day-one milestone's "equivalent results on SQLite
 * and Postgres" claim depends on. The PostgresGraphStore round-trip gates on
 * createSqlClient(env) being non-null: with no DATABASE_URL (the default CI
 * and local posture, and this bead's build environment) a single passing
 * test records the skip, matching tests/orchestration-run-store-postgres.test.mjs's
 * established pattern — this class is structural-only until a real Postgres
 * round-trip runs it.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createSqlClient, closeSqlClient } from '../../lib/storage/backend.mjs';
import { PostgresGraphStore, bindNamedParams } from '../../lib/graph/relational/postgres-store.mjs';
import { QUERY_UP, QUERY_CYCLES } from '../../lib/graph/relational/queries.mjs';

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
  });
  // :node_id appears twice in QUERY_UP (seed + final WHERE); both occurrences
  // must resolve to the same $n, not allocate a second positional slot.
  const nodeIdSlot = text.match(/\$(\d+)/)[1];
  const occurrences = [...text.matchAll(new RegExp(`\\$${nodeIdSlot}(?!\\d)`, 'g'))];
  assert.ok(occurrences.length >= 2, ':node_id should map to the same $n at every occurrence');
  assert.equal(values.length, 3, 'exactly 3 distinct named params in QUERY_UP');
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
  test.after(async () => { await closeSqlClient(sql); });

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
}
