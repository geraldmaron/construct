#!/usr/bin/env node
/**
 * lib/storage/postgres-backup.mjs — durable stash/restore for the managed construct-postgres container.
 *
 * Mirrors the Langfuse backup pattern in service-manager.mjs. Called from:
 *   - construct down  → stashConstructDb  (dump before container stop)
 *   - construct setup → restoreConstructDb (reload after fresh container start)
 *
 * Dumps are stored in ~/.construct/backups/postgres/ as pg_dump custom-format
 * files. The N most recent are kept; older ones are pruned automatically.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const POSTGRES_CONTAINER = 'construct-postgres';
const POSTGRES_USER = 'construct';
const POSTGRES_DB = 'construct';
const DEFAULT_KEEP = 5;

function pruneBackupDir(dir, keep) {
  try {
    const dumps = fs.readdirSync(dir)
      .filter((f) => f.startsWith('construct-') && f.endsWith('.dump'))
      .sort()
      .reverse();
    for (const dump of dumps.slice(keep)) {
      fs.rmSync(path.join(dir, dump), { force: true });
      fs.rmSync(path.join(dir, dump.replace('.dump', '.json')), { force: true });
    }
  } catch { /* non-critical */ }
}

/**
 * Dump the construct Postgres database to a timestamped file under
 * ~/.construct/backups/postgres/. Safe to call when the container is not
 * running — returns { status: 'no-data' } silently.
 */
export function stashConstructDb({
  homeDir = os.homedir(),
  spawnSyncFn = spawnSync,
  keep = DEFAULT_KEEP,
} = {}) {
  const stashDir = path.join(homeDir, '.construct', 'backups', 'postgres');
  fs.mkdirSync(stashDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dumpFile = path.join(stashDir, `construct-${timestamp}.dump`);
  const manifestFile = path.join(stashDir, `construct-${timestamp}.json`);

  const dump = spawnSyncFn('docker', [
    'exec', POSTGRES_CONTAINER,
    'pg_dump', '-U', POSTGRES_USER, '-d', POSTGRES_DB,
    '-Fc', '--data-only',
  ], { stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 200 * 1024 * 1024 });

  const hasData = dump.status === 0 && dump.stdout?.length > 100;
  if (!hasData) return { status: 'no-data', stashPath: null };

  fs.writeFileSync(dumpFile, dump.stdout);
  fs.writeFileSync(manifestFile, JSON.stringify({
    version: 1,
    createdAt: new Date().toISOString(),
    reason: 'pre-shutdown-stash',
    dumpFile: path.basename(dumpFile),
    dumpBytes: dump.stdout.length,
  }, null, 2) + '\n');

  pruneBackupDir(stashDir, keep);
  return { status: 'ok', stashPath: dumpFile, bytes: dump.stdout.length };
}

/**
 * Restore the most recent stash into a running construct-postgres container.
 * Safe to call when no stash exists — returns { status: 'no-stash' } silently.
 * The schema must already exist (run migration before calling this).
 */
export function restoreConstructDb({
  homeDir = os.homedir(),
  spawnSyncFn = spawnSync,
} = {}) {
  const stashDir = path.join(homeDir, '.construct', 'backups', 'postgres');
  if (!fs.existsSync(stashDir)) return { status: 'no-stash' };

  const dumps = fs.readdirSync(stashDir)
    .filter((f) => f.startsWith('construct-') && f.endsWith('.dump'))
    .sort()
    .reverse();
  if (dumps.length === 0) return { status: 'no-stash' };

  const latestDump = path.join(stashDir, dumps[0]);

  const cp = spawnSyncFn('docker', [
    'cp', latestDump, `${POSTGRES_CONTAINER}:/tmp/construct.dump`,
  ], { stdio: 'ignore' });
  if (cp.status !== 0) return { status: 'copy-failed', stashPath: latestDump };

  const restore = spawnSyncFn('docker', [
    'exec', POSTGRES_CONTAINER,
    'pg_restore', '-U', POSTGRES_USER, '-d', POSTGRES_DB,
    '--data-only', '--disable-triggers', '--no-owner',
    '--if-exists',
    '/tmp/construct.dump',
  ], { stdio: 'ignore' });

  return {
    status: restore.status === 0 ? 'restored' : 'restore-failed',
    stashPath: latestDump,
    exitCode: restore.status,
  };
}

/**
 * Delete all stashed backups under ~/.construct/backups/postgres/.
 * Called by `construct storage reset` and uninstall flows.
 */
export function purgeConstructDbStashes({ homeDir = os.homedir() } = {}) {
  const stashDir = path.join(homeDir, '.construct', 'backups', 'postgres');
  if (!fs.existsSync(stashDir)) return { status: 'ok', deletedCount: 0 };
  const files = fs.readdirSync(stashDir).map((f) => path.join(stashDir, f));
  for (const f of files) fs.rmSync(f, { force: true });
  return { status: 'ok', deletedCount: files.length };
}
