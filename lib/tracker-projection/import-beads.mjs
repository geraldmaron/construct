/**
 * lib/tracker-projection/import-beads.mjs — read-only importer that turns a bd
 * snapshot into Projection records (construct-b0nny.27 / E8).
 *
 * `importBeads` consumes an array of bd issues (as returned by `bd list --all
 * --json`) and builds one Projection per issue. The importer is read-only
 * relative to bd — no `bd create` call — so it structurally cannot repeat the
 * program's known `bd create --graph` lossiness (which drops parent/deps/
 * acceptance-criteria). Every issue's whole original record is preserved
 * verbatim in the projection's `raw_record` (buildProjection), making import
 * provably zero-loss; `verifyRawRecords` proves it against the source snapshot.
 *
 * `snapshotBeads` reads the live tracker with `bd list --all --limit 0 --json`
 * — the lock-free concurrent read bd already supports — returning the same
 * neutral array `importBeads` consumes, so callers can snapshot once (robust to
 * concurrent bd writers) and import/reconcile against the frozen copy.
 */

import { spawnSync } from 'node:child_process';

import { buildProjection, canonicalJson } from './projection.mjs';

// The whole-corpus read (bd list --all --limit 0) runs into the megabytes; the
// default 1MB spawnSync buffer truncates it to a SIGPIPE/ENOBUFS, so a large
// buffer is required. Success is decided by whether stdout parses to an issue
// array, not by exit status alone — bd can emit a full JSON body while exiting
// non-zero under buffer pressure.

const SNAPSHOT_MAX_BUFFER = 256 * 1024 * 1024;

/**
 * Read the full live bd issue set as a neutral array. Read-only: no bd write,
 * no lock. Returns [] when bd is unavailable or the output is not parseable.
 *
 * @param {{ runner?: typeof spawnSync, cwd?: string }} [opts]
 * @returns {object[]}
 */
export function snapshotBeads({ runner = spawnSync, cwd = process.cwd() } = {}) {
  const result = runner('bd', ['list', '--all', '--limit', '0', '--json'], {
    cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: SNAPSHOT_MAX_BUFFER,
  });
  try {
    const parsed = JSON.parse(result.stdout);
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed?.issues)) return parsed.issues;
    return [];
  } catch {
    return [];
  }
}

/**
 * Build Projection records from a bd snapshot. Pure over `issues`. Issues
 * without a string `id` are collected under `skipped` rather than silently
 * dropped, so a malformed input surfaces instead of vanishing.
 *
 * @param {object[]} issues
 * @param {{ workspace?: string|null, importedAt?: string }} [opts]
 * @returns {{ projections: object[], stats: { total: number, imported: number, skipped: object[] } }}
 */
export function importBeads(issues, { workspace = null, importedAt = null } = {}) {
  const projections = [];
  const skipped = [];
  for (const issue of Array.isArray(issues) ? issues : []) {
    if (!issue || typeof issue !== 'object' || typeof issue.id !== 'string') {
      skipped.push(issue);
      continue;
    }
    projections.push(buildProjection(issue, { workspace, importedAt }));
  }
  return {
    projections,
    stats: { total: (Array.isArray(issues) ? issues.length : 0), imported: projections.length, skipped },
  };
}

/**
 * Prove raw-record preservation: every projection's `raw_record` must be a
 * verbatim, field-for-field copy of the original issue it was built from.
 * Returns per-issue mismatches (empty when zero data was lost). Comparison is
 * key-order-independent (stable stringify) so field ordering is not a false
 * positive.
 *
 * @param {object[]} projections
 * @param {object[]} originals - the source issues importBeads consumed
 * @returns {{ ok: boolean, checked: number, mismatches: object[] }}
 */
export function verifyRawRecords(projections, originals) {
  const byId = new Map();
  for (const issue of originals || []) {
    if (issue && typeof issue.id === 'string') byId.set(issue.id, issue);
  }
  const mismatches = [];
  for (const projection of projections || []) {
    const original = byId.get(projection.external_id);
    if (!original) {
      mismatches.push({ id: projection.external_id, reason: 'no-source-issue' });
      continue;
    }
    if (canonicalJson(projection.raw_record) !== canonicalJson(original)) {
      const lostKeys = Object.keys(original).filter((k) => !(k in (projection.raw_record || {})));
      mismatches.push({ id: projection.external_id, reason: 'raw-record-differs', lostKeys });
    }
  }
  return { ok: mismatches.length === 0, checked: (projections || []).length, mismatches };
}
