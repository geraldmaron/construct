/**
 * kernel/state/migrate.ts — the one-way upgrade from complete format 5 to 6.
 * Only `construct migrate` upgrades a store, after every session is stopped
 * and a backup is taken under the write lock. Incomplete stores are refused
 * unread; this upgrade does not repair them.
 */

import type { DatabaseSync } from 'node:sqlite';
import { REQUIRED_TABLES } from './schema.ts';

export function isCompleteV5(db: DatabaseSync): boolean {
  const rows = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>;
  const names = new Set(rows.map((row) => row.name));
  return [...REQUIRED_TABLES, 'work_legacy_ids'].every((table) => names.has(table));
}

export function migrateV5ToV6(db: DatabaseSync): void {
  db.exec('DROP INDEX IF EXISTS work_legacy_work; DROP TABLE work_legacy_ids;');
  db.prepare("UPDATE meta SET value = '6' WHERE key = 'format_version'").run();
}
