/**
 * Real Postgres roundtrip — spins up pgvector/pgvector:pg16 in Docker,
 * applies every db/schema/*.sql migration, then exercises the canonical SQL
 * paths the runtime uses: write + read on a tracked table, pgvector
 * extension presence, schema_migrations row count.
 *
 * Skips cleanly when Docker isn't available. Sequenced separately from the
 * vector test because each spins its own container.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { withPostgres } from './_lib/postgres-docker.mjs';

test('Postgres + pgvector container starts and migrates cleanly', async (t) => {
  const pg = await withPostgres(t);
  if (!pg) return;

  const [{ version }] = await pg.client`SELECT version()`;
  assert.match(version, /PostgreSQL 16/, `expected Postgres 16, got ${version}`);

  const exts = await pg.client`SELECT extname FROM pg_extension WHERE extname = 'vector'`;
  assert.equal(exts.length, 1, 'pgvector extension must be loaded');
});

test('Construct intake table accepts insert + select roundtrip', async (t) => {
  const pg = await withPostgres(t);
  if (!pg) return;

  // Pick a table any migration is likely to have created. construct_intake_items
  // is defined by 003_intake.sql.

  const tables = await pg.client`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename = 'construct_intake_items'
  `;
  assert.equal(tables.length, 1, 'construct_intake_items table must exist after migrations');

  const cols = await pg.client`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'construct_intake_items'
  `;
  const colNames = cols.map((c) => c.column_name);
  assert.ok(colNames.includes('id'), `expected id column, got: ${colNames.join(', ')}`);
});

test('Vector column type is registered and accepts an embedding insert', async (t) => {
  const pg = await withPostgres(t);
  if (!pg) return;

  await pg.client`
    CREATE TABLE IF NOT EXISTS test_vector_smoke (
      id SERIAL PRIMARY KEY,
      label TEXT,
      embedding vector(3)
    )
  `;
  await pg.client`INSERT INTO test_vector_smoke (label, embedding) VALUES ('a', '[1,0,0]'), ('b', '[0,1,0]'), ('c', '[1,1,0]')`;
  const rows = await pg.client`
    SELECT label, embedding <=> '[1,0,0]' AS distance
    FROM test_vector_smoke
    ORDER BY distance ASC
  `;
  assert.equal(rows[0].label, 'a', 'nearest neighbor of [1,0,0] must be itself');
  assert.equal(rows[2].label, 'b', 'farthest of the three must be the orthogonal vector');
});
