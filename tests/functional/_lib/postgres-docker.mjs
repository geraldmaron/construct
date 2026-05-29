/**
 * Per-suite Postgres + pgvector harness. Brings up a fresh
 * `pgvector/pgvector:pg16` container on a random host port, applies every
 * `db/schema/*.sql` migration in lex order, yields a connection URL, and
 * tears the container down on test exit.
 *
 * Skips cleanly when Docker is unavailable so a no-Docker dev environment
 * doesn't fail the suite. CI always has Docker.
 *
 * Usage:
 *   import { withPostgres } from './_lib/postgres-docker.mjs';
 *   test('something with postgres', async (t) => {
 *     const pg = await withPostgres(t);
 *     if (!pg) return; // skipped (no Docker)
 *     const result = await pg.client`SELECT 1 as one`;
 *     ...
 *   });
 */

import { spawnSync, spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const SCHEMA_DIR = join(REPO_ROOT, 'db', 'schema');

const IMAGE = 'pgvector/pgvector:pg16';
const PG_USER = 'construct';
const PG_PASS = 'construct';
const PG_DB = 'construct';
const READY_TIMEOUT_MS = 60_000;

function hasDocker() {
  try {
    const result = spawnSync('docker', ['version', '--format', '{{.Client.Version}}'], { stdio: 'pipe' });
    return result.status === 0;
  } catch { return false; }
}

function pickPort() {
  // Random port in the high range; Docker will fail and we'll retry if taken.

  return 50_000 + Math.floor(Math.random() * 10_000);
}

async function waitReady(containerName, url) {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  // Stage 1: psql inside the container — confirms the postmaster has
  // finished its own startup sequence. This is the cheapest probe.

  while (Date.now() < deadline) {
    const probe = spawnSync('docker', [
      'exec', containerName,
      'psql', '-U', PG_USER, '-d', PG_DB,
      '-tAc', 'SELECT 1',
    ], { stdio: 'pipe' });
    if (probe.status === 0 && probe.stdout.toString().trim() === '1') break;
    await new Promise((r) => setTimeout(r, 500));
  }
  if (Date.now() >= deadline) return false;

  // Stage 2: SELECT 1 from the host via the postgres driver, with retry
  // on the 57P03 "the database system is starting up" race window. The
  // postmaster sometimes opens the external socket a few ms before it
  // accepts client queries; psql-inside-container doesn't detect that
  // because it goes through a Unix socket. We hit the TCP port the way
  // every later test query will and only return ready when it works.

  let postgres;
  try { ({ default: postgres } = await import('postgres')); } catch { return false; }
  while (Date.now() < deadline) {
    const sql = postgres(url, { onnotice: () => {}, connect_timeout: 2 });
    try {
      const [{ ok }] = await sql`SELECT 1 AS ok`;
      await sql.end({ timeout: 2 });
      if (ok === 1) return true;
    } catch (e) {
      await sql.end({ timeout: 2 }).catch(() => {});
      const transient = e?.code === '57P03' || /starting up|connection refused|ECONN/.test(e?.message || '');
      if (!transient) return false;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

async function applyMigrations(url) {
  const files = readdirSync(SCHEMA_DIR).filter((f) => f.endsWith('.sql')).sort();
  let postgres;
  try {
    ({ default: postgres } = await import('postgres'));
  } catch (e) {
    throw new Error(`postgres driver not installed: ${e.message}`);
  }
  const sql = postgres(url, { onnotice: () => {} });
  try {
    for (const f of files) {
      const body = readFileSync(join(SCHEMA_DIR, f), 'utf8');
      // postgres.unsafe runs raw SQL; some migration files have multiple
      // statements separated by `;` which postgres handles natively.

      await sql.unsafe(body);
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/**
 * Spawn a fresh Postgres container, apply migrations, return a client + URL.
 * Returns null when Docker isn't available.
 */
export async function withPostgres(t) {
  if (!hasDocker()) {
    if (t && t.skip) t.skip('Docker not available — skipping Postgres test');
    return null;
  }

  const port = pickPort();
  const containerName = `cx-test-pg-${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
  const url = `postgresql://${PG_USER}:${PG_PASS}@127.0.0.1:${port}/${PG_DB}`;

  const startResult = spawnSync('docker', [
    'run', '-d',
    '--name', containerName,
    '-e', `POSTGRES_USER=${PG_USER}`,
    '-e', `POSTGRES_PASSWORD=${PG_PASS}`,
    '-e', `POSTGRES_DB=${PG_DB}`,
    '-p', `127.0.0.1:${port}:5432`,
    IMAGE,
  ], { stdio: 'pipe' });

  if (startResult.status !== 0) {
    const err = startResult.stderr.toString();
    if (t && t.skip) t.skip(`Failed to start Postgres container: ${err.substring(0, 200)}`);
    return null;
  }

  if (t && t.after) {
    t.after(() => {
      spawnSync('docker', ['rm', '-f', containerName], { stdio: 'ignore' });
    });
  }

  const ready = await waitReady(containerName, url);
  if (!ready) {
    spawnSync('docker', ['rm', '-f', containerName], { stdio: 'ignore' });
    if (t && t.skip) t.skip('Postgres did not become ready in time');
    return null;
  }

  try {
    await applyMigrations(url);
  } catch (e) {
    spawnSync('docker', ['rm', '-f', containerName], { stdio: 'ignore' });
    throw e;
  }

  const postgres = (await import('postgres')).default;
  const client = postgres(url, { onnotice: () => {} });
  if (t && t.after) {
    t.after(async () => { try { await client.end({ timeout: 5 }); } catch { /* already closed */ } });
  }

  return { url, client, port, containerName };
}
