/**
 * tests/functional/skills-correlate-quality.functional.test.mjs — verify
 * the end-to-end cx_score → construct_cx_scores → correlation-view path.
 *
 * Without a running Postgres the migration can't apply and the producer
 * has nowhere to write; this test runs only when DATABASE_URL points at
 * a writable database (locally: `construct dev` provisions one; CI:
 * postgres-integration job exposes one). Outside of that, the test
 * skips with a clear reason rather than failing.
 *
 * Coverage:
 *   1. The 010 schema applies cleanly on top of 008.
 *   2. cxScore writes a row when DATABASE_URL is set.
 *   3. The correlation view returns aggregated stats when paired with
 *      skill-invocation rows for the same session_id.
 *   4. `construct skills correlate-quality` prints the rollup without
 *      printing the "no data" fallback.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const BIN = path.join(REPO, 'bin', 'construct');
const SCHEMA_010 = path.join(REPO, 'db', 'schema', '010_cx_scores.sql');
const SCHEMA_008 = path.join(REPO, 'db', 'schema', '008_skill_usage.sql');

const DB_URL = process.env.CONSTRUCT_TEST_DB_URL || process.env.DATABASE_URL;

// Quick reachability check: DATABASE_URL may be set in env but the actual
// Postgres process may be down (e.g. `construct stop` ran in a sibling
// test). A 1-second connect probe avoids burning the test on ECONNREFUSED.
let HAS_DB = false;
if (DB_URL) {
  try {
    const { createSqlClient, closeSqlClient } = await import('../../lib/storage/backend.mjs');
    const probe = createSqlClient({ ...process.env, DATABASE_URL: DB_URL });
    if (probe) {
      try {
        await Promise.race([
          probe`select 1`,
          new Promise((_, rej) => setTimeout(() => rej(new Error('probe timeout')), 1000)),
        ]);
        HAS_DB = true;
      } catch { HAS_DB = false; }
      finally { await closeSqlClient(probe); }
    }
  } catch { HAS_DB = false; }
}

test('010_cx_scores.sql is parseable and has the correlation view', () => {
  const sql = fs.readFileSync(SCHEMA_010, 'utf8');
  assert.match(sql, /create table if not exists construct_cx_scores/);
  assert.match(sql, /create or replace view construct_skill_quality_correlation/);
  assert.match(sql, /percentile_cont\(0\.5\) within group/);
  assert.match(sql, /percentile_cont\(0\.10\) within group/);
  assert.match(sql, /percentile_cont\(0\.90\) within group/);
});

test('010 schema references the skill_invocations table from 008 (migration order)', () => {
  const sql = fs.readFileSync(SCHEMA_010, 'utf8');
  const eight = fs.readFileSync(SCHEMA_008, 'utf8');
  assert.match(sql, /construct_skill_invocations/);
  assert.match(eight, /create table if not exists construct_skill_invocations/);
});

test('cxScore writes to construct_cx_scores when DATABASE_URL is set', { skip: !HAS_DB }, async () => {
  const { createSqlClient, closeSqlClient } = await import(`../../lib/storage/backend.mjs?cache=${Date.now()}`);
  const { cxScore } = await import(`../../lib/mcp/tools/telemetry.mjs?cache=${Date.now()}`);
  const sql = createSqlClient({ ...process.env, DATABASE_URL: DB_URL });
  assert.ok(sql, 'expected SQL client when DB_URL is set');
  try {
    // Apply both migrations idempotently
    await sql.unsafe(fs.readFileSync(SCHEMA_008, 'utf8'));
    await sql.unsafe(fs.readFileSync(SCHEMA_010, 'utf8'));

    const traceId = `t-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const sessionId = `s-${Date.now()}`;
    const result = await cxScore({
      trace_id: traceId,
      session_id: sessionId,
      agent_id: 'cx-engineer',
      value: 0.92,
      comment: 'fixture',
    });
    assert.equal(result.ok, true, `cxScore returned ok:false — ${JSON.stringify(result)}`);

    const rows = await sql`select trace_id, value, agent_id from construct_cx_scores where trace_id = ${traceId}`;
    assert.equal(rows.length, 1, `expected 1 row for trace_id=${traceId}, got ${rows.length}`);
    assert.equal(Number(rows[0].value), 0.92);
    assert.equal(rows[0].agent_id, 'cx-engineer');
  } finally {
    await closeSqlClient(sql);
  }
});

test('correlation view returns aggregated stats when skill + cx_score rows share a session_id', { skip: !HAS_DB }, async () => {
  const { createSqlClient, closeSqlClient } = await import(`../../lib/storage/backend.mjs?cache=${Date.now()}`);
  const sql = createSqlClient({ ...process.env, DATABASE_URL: DB_URL });
  try {
    await sql.unsafe(fs.readFileSync(SCHEMA_008, 'utf8'));
    await sql.unsafe(fs.readFileSync(SCHEMA_010, 'utf8'));

    const sessionId = `s-corr-${Date.now()}`;
    const skillId = `skill-fixture-${Date.now().toString(36)}`;
    // Insert a skill invocation
    await sql`
      insert into construct_skill_invocations (ts, skill_id, source, session_id)
      values (now(), ${skillId}, 'test-fixture', ${sessionId})
    `;
    // Insert three cx_scores for the same session
    for (const v of [0.7, 0.8, 0.95]) {
      await sql`
        insert into construct_cx_scores (ts, trace_id, session_id, agent_id, name, value)
        values (now(), ${`t-${v}`}, ${sessionId}, 'cx-engineer', 'quality', ${v})
      `;
    }
    const rows = await sql`
      select skill_id, sessions, score_count, mean_score, median_score
      from construct_skill_quality_correlation
      where skill_id = ${skillId}
    `;
    assert.equal(rows.length, 1, 'expected one row per skill_id with at least one matching session');
    assert.equal(Number(rows[0].sessions), 1);
    assert.equal(Number(rows[0].score_count), 3);
    assert.ok(Number(rows[0].mean_score) > 0.7 && Number(rows[0].mean_score) < 0.95,
      `mean=${rows[0].mean_score} should be between 0.7 and 0.95`);
  } finally {
    await closeSqlClient(sql);
  }
});

test('`construct skills correlate-quality` runs end-to-end against a live DB (or skips cleanly when none)', { skip: !HAS_DB }, async () => {
  // Seed at least one matching row so the rollup branch is exercised
  // rather than the "no data" fallback. Then invoke the CLI in a child
  // process and assert it printed the header row.
  const { createSqlClient, closeSqlClient } = await import(`../../lib/storage/backend.mjs?cache=${Date.now()}`);
  const sql = createSqlClient({ ...process.env, DATABASE_URL: DB_URL });
  try {
    await sql.unsafe(fs.readFileSync(SCHEMA_008, 'utf8'));
    await sql.unsafe(fs.readFileSync(SCHEMA_010, 'utf8'));
    const sessionId = `s-cli-${Date.now()}`;
    const skillId = `skill-cli-${Date.now().toString(36)}`;
    await sql`insert into construct_skill_invocations (ts, skill_id, source, session_id) values (now(), ${skillId}, 'test', ${sessionId})`;
    await sql`insert into construct_cx_scores (ts, trace_id, session_id, name, value) values (now(), ${`t-${Date.now()}`}, ${sessionId}, 'quality', 0.88)`;
  } finally { await closeSqlClient(sql); }

  const result = spawnSync(BIN, ['skills', 'correlate-quality'], {
    env: { ...process.env, DATABASE_URL: DB_URL },
    encoding: 'utf8',
    timeout: 15000,
  });
  assert.equal(result.status, 0, `unexpected exit ${result.status}; stderr: ${result.stderr}`);
  assert.match(result.stdout, /skill_id\s+sessions\s+scores/, 'expected header row when rollup has data');
});
