/**
 * lib/storage/store-version.mjs — versioned schema for the JSON stores.
 *
 * The observation, entity, and session stores write JSON arrays (or objects)
 * to disk. Until now, the on-disk format had no version stamp, which meant
 * any future schema change had to either fork the file or risk silently
 * breaking older data. This module provides a thin, opt-in versioning
 * layer:
 *
 *   readVersioned(filePath, storeId)
 *       Returns the on-disk records, lazily upgrading them through the
 *       store's migration chain if the embedded version is older than the
 *       current one. Existing unversioned files (plain arrays) are treated
 *       as version 1 and stamped on the next write.
 *
 *   writeVersioned(filePath, storeId, records)
 *       Wraps the records in `{ schemaVersion, storeId, records }` and
 *       writes atomically. Callers always read/write through this helper
 *       so the on-disk format stays canonical.
 *
 *   registerMigration(storeId, fromVersion, toVersion, migrate)
 *       Record a one-step migration. The runtime walks migrations in
 *       order until the records reach the current version.
 *
 * Migrations are pure functions over records; they cannot reach the network,
 * fork processes, or call other stores. That keeps lazy upgrade safe to run
 * inside a hot Read path.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const CURRENT_VERSIONS = {
  observations: 1,
  observations_vectors: 1,
  observations_index: 1,
  entities: 1,
  entity_vectors: 1,
  sessions: 1,
  session_vectors: 1,
};

const MIGRATIONS = new Map();

export function registerMigration(storeId, fromVersion, migrate) {
  const key = `${storeId}@${fromVersion}`;
  if (MIGRATIONS.has(key)) {
    throw new Error(`Migration already registered: ${key}`);
  }
  MIGRATIONS.set(key, migrate);
}

export function currentVersion(storeId) {
  return CURRENT_VERSIONS[storeId] ?? 1;
}

function unwrap(parsed) {
  if (parsed && typeof parsed === 'object' && Array.isArray(parsed.records)) {
    return {
      schemaVersion: Number.isInteger(parsed.schemaVersion) ? parsed.schemaVersion : 1,
      records: parsed.records,
    };
  }
  if (Array.isArray(parsed)) {
    return { schemaVersion: 1, records: parsed };
  }
  return { schemaVersion: 1, records: [] };
}

function migrateOnce(storeId, schemaVersion, records) {
  const migrate = MIGRATIONS.get(`${storeId}@${schemaVersion}`);
  if (!migrate) return null;
  const next = migrate(records);
  if (!Array.isArray(next)) {
    throw new Error(`Migration ${storeId}@${schemaVersion}→ must return an array of records`);
  }
  return next;
}

/**
 * Read a versioned JSON store. Lazily applies migrations to bring records up
 * to the current version. Returns plain records (caller doesn't see the
 * version envelope).
 */
export function readVersioned(filePath, storeId, fallback = []) {
  if (!existsSync(filePath)) return fallback;
  let parsed;
  try { parsed = JSON.parse(readFileSync(filePath, 'utf8')); }
  catch { return fallback; }

  let { schemaVersion, records } = unwrap(parsed);
  const target = currentVersion(storeId);

  while (schemaVersion < target) {
    const next = migrateOnce(storeId, schemaVersion, records);
    if (next === null) break;
    records = next;
    schemaVersion += 1;
  }

  return records;
}

/**
 * Write a versioned JSON store. Always stamps the current version.
 */
export function writeVersioned(filePath, storeId, records) {
  mkdirSync(dirname(filePath), { recursive: true });
  const payload = {
    schemaVersion: currentVersion(storeId),
    storeId,
    records: Array.isArray(records) ? records : [],
  };
  writeFileSync(filePath, JSON.stringify(payload, null, 2) + '\n');
}
