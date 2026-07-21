/**
 * lib/tracker-projection/store.mjs — durable JSONL persistence for Beads
 * Projection records (construct-b0nny.27 / E8).
 *
 * Projections live at `.construct/tracker-projections/beads.jsonl` (+ a
 * `meta.json` summary), reusing the atomic tmp-then-rename write lib/graph/
 * store.mjs already uses. JSONL keeps the store diff-clean and re-verifiable,
 * and the store loads with bd absent — tracker independence (concept 16 test,
 * directive §19): reading a projection needs no bd process.
 *
 * `upsertProjections` merges by projection id so a re-import updates existing
 * rows rather than minting duplicates, preserving each row's earliest
 * `importedAt` while refreshing the rest.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';

import { CONFIG_DIR_NAME } from '../config-dir.mjs';

const STORE_SUBDIR = path.join(CONFIG_DIR_NAME, 'tracker-projections');
const PROJECTIONS_FILE = 'beads.jsonl';
const META_FILE = 'meta.json';

export function projectionsDir(rootDir) {
  return path.join(rootDir, STORE_SUBDIR);
}

function projectionsPath(rootDir) {
  return path.join(projectionsDir(rootDir), PROJECTIONS_FILE);
}

function metaPath(rootDir) {
  return path.join(projectionsDir(rootDir), META_FILE);
}

function writeAtomic(filePath, contents) {
  const tmp = `${filePath}.tmp`;
  writeFileSync(tmp, contents, 'utf8');
  renameSync(tmp, filePath);
}

function readJsonl(filePath) {
  if (!existsSync(filePath)) return [];
  const out = [];
  for (const line of readFileSync(filePath, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* skip malformed line */ }
  }
  return out;
}

function countByState(projections) {
  const counts = {};
  for (const p of projections) counts[p.state] = (counts[p.state] ?? 0) + 1;
  return counts;
}

/**
 * Persist the full projection set (regenerate semantics). Writes the JSONL rows
 * and a meta summary atomically.
 *
 * @param {string} rootDir
 * @param {object[]} projections
 * @returns {{ count: number, dir: string }}
 */
export function writeProjections(rootDir, projections = []) {
  const dir = projectionsDir(rootDir);
  mkdirSync(dir, { recursive: true });
  const rows = projections.map((p) => JSON.stringify(p)).join('\n');
  writeAtomic(projectionsPath(rootDir), rows + (projections.length ? '\n' : ''));
  const meta = {
    schemaVersion: 1,
    tracker: 'beads',
    generatedAt: new Date().toISOString(),
    count: projections.length,
    byState: countByState(projections),
  };
  writeAtomic(metaPath(rootDir), JSON.stringify(meta, null, 2) + '\n');
  return { count: projections.length, dir };
}

/**
 * Load the persisted projection set. Returns [] when the store does not exist.
 *
 * @param {string} rootDir
 * @returns {object[]}
 */
export function loadProjections(rootDir) {
  return readJsonl(projectionsPath(rootDir));
}

export function loadProjectionsMeta(rootDir) {
  try { return JSON.parse(readFileSync(metaPath(rootDir), 'utf8')); } catch { return null; }
}

/**
 * Merge `incoming` projections into the persisted set by id: a matching id
 * takes the incoming row while carrying forward the stored `importedAt`; a new
 * id is appended. Ordering is stable by id for diff-clean output.
 *
 * @param {string} rootDir
 * @param {object[]} incoming
 * @returns {{ count: number, dir: string }}
 */
export function upsertProjections(rootDir, incoming = []) {
  const byId = new Map();
  for (const existing of loadProjections(rootDir)) byId.set(existing.id, existing);
  for (const next of incoming) {
    const prior = byId.get(next.id);
    byId.set(next.id, prior ? { ...next, importedAt: prior.importedAt ?? next.importedAt } : next);
  }
  const merged = [...byId.values()].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return writeProjections(rootDir, merged);
}
