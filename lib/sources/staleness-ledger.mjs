/**
 * lib/sources/staleness-ledger.mjs — append-only staleness ledger for source
 * targets.
 *
 * Every detected upstream change (refreshWatch) is
 * recorded here so `construct doctor` / `construct status` / the source-refresh
 * daemon can show a changelog of when each watched target last moved, not just
 * a boolean. The ledger is machine state under
 * `~/.construct/projects/<key>/context-repos/source-ledger.jsonl`, so it is
 * team/project scoped and never committed to the project tree.
 */

import fs from 'node:fs';

import { resolveStatePath } from '../state-root.mjs';

export function ledgerPath(projectRoot = process.cwd(), { ensureDir = false } = {}) {
  return resolveStatePath(projectRoot, 'context-repos', 'source-ledger.jsonl', { ensureDir });
}

/**
 * Append a source-change record to the ledger. Returns the written entry.
 *
 * @param {string} targetId
 * @param {{ kind?: string, previous?: string|null, current?: string|null, at?: string, detail?: string, projectRoot?: string }} [info]
 */
export function recordSourceChange(targetId, { kind = 'unknown', previous = null, current = null, at, detail, projectRoot = process.cwd() } = {}) {
  const entry = {
    targetId,
    kind,
    previous,
    current,
    at: at ?? new Date().toISOString(),
    detail: detail ?? null,
  };
  const p = ledgerPath(projectRoot, { ensureDir: true });
  fs.appendFileSync(p, `${JSON.stringify(entry)}\n`);
  return entry;
}

/**
 * Read the ledger most-recent-first. Optionally filtered by targetId.
 * @returns {Array<{targetId:string,kind:string,previous:string|null,current:string|null,at:string,detail:string|null}>}
 */
export function readSourceLedger({ projectRoot = process.cwd(), targetId = null, limit = null } = {}) {
  const p = ledgerPath(projectRoot);
  if (!fs.existsSync(p)) return [];
  const lines = fs.readFileSync(p, 'utf8').split('\n').filter(Boolean);
  const entries = lines.map((l) => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);
  const filtered = targetId ? entries.filter((e) => e.targetId === targetId) : entries;
  const ordered = filtered.reverse();
  return limit != null ? ordered.slice(0, limit) : ordered;
}
