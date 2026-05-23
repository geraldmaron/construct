/**
 * lib/outcomes/aggregate.mjs — Per-role rolling success-rate summary.
 *
 * Reads `.cx/outcomes/<role>.jsonl` files and produces `_summary.json`:
 *
 *   { generatedAt, roles: { <role>: { count, success, successRate,
 *                                     p50DurationMs, last30: { count, successRate } } } }
 *
 * The classifier reads `successRate` to apply a tie-breaker soft re-rank
 * (capped at ±0.05 in lib/intake/classify.mjs so it cannot invert the
 * primary keyword signal).
 */
import fs from 'node:fs';
import path from 'node:path';
import { listOutcomes } from './record.mjs';

const DAY_MS = 24 * 60 * 60 * 1000;
const LAST_WINDOW_DAYS = 30;

function median(nums) {
  if (nums.length === 0) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? Math.round((sorted[mid - 1] + sorted[mid]) / 2) : sorted[mid];
}

function rollupRole(outcomes) {
  const total = outcomes.length;
  if (total === 0) return null;
  const success = outcomes.filter((o) => o.success === true).length;
  const durations = outcomes
    .map((o) => o.durationMs)
    .filter((d) => Number.isFinite(d) && d > 0);

  const cutoff = Date.now() - LAST_WINDOW_DAYS * DAY_MS;
  const recent = outcomes.filter((o) => Date.parse(o.ts) >= cutoff);
  const recentSuccess = recent.filter((o) => o.success === true).length;

  return {
    count: total,
    success,
    successRate: total > 0 ? Number((success / total).toFixed(3)) : 0,
    p50DurationMs: median(durations),
    last30: {
      count: recent.length,
      successRate: recent.length > 0 ? Number((recentSuccess / recent.length).toFixed(3)) : 0,
    },
  };
}

/**
 * List every role with outcome data in this project. Returns role ids.
 */
export function listRolesWithOutcomes(cwd) {
  const dir = path.join(cwd, '.cx', 'outcomes');
  if (!fs.existsSync(dir)) return [];
  const seen = new Set();
  for (const f of fs.readdirSync(dir)) {
    const m = /^([a-z0-9-]+)(\.\d+)?\.jsonl$/.exec(f);
    if (m) seen.add(m[1]);
  }
  return Array.from(seen).sort();
}

/**
 * Rebuild the summary from all per-role JSONL files. Idempotent.
 */
export function aggregateOutcomes(cwd) {
  const roles = listRolesWithOutcomes(cwd);
  const out = { generatedAt: new Date().toISOString(), roles: {} };
  for (const role of roles) {
    const rollup = rollupRole(listOutcomes(cwd, role));
    if (rollup) out.roles[role] = rollup;
  }
  const dir = path.join(cwd, '.cx', 'outcomes');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '_summary.json'), JSON.stringify(out, null, 2) + '\n');
  return out;
}

/**
 * Read the cached summary without recomputing. Keeps the classifier
 * tiebreaker on an O(1) hot path.
 */
export function readSummary(cwd) {
  const p = path.join(cwd, '.cx', 'outcomes', '_summary.json');
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

/**
 * Tiebreaker score for the classifier. Returns a number in [-0.05, 0.05]
 * derived from the role's recent success rate. Default behavior on missing
 * data is 0 (no influence).
 */
export function outcomeBoost(cwd, role, { cap = 0.05 } = {}) {
  const summary = readSummary(cwd);
  const stats = summary?.roles?.[role];
  if (!stats || !stats.last30 || stats.last30.count < 3) return 0;
  // Map [0.5, 1.0] success → [0, cap]; [0, 0.5] → [-cap, 0]. Linear, capped.
  const rate = stats.last30.successRate;
  const centered = (rate - 0.5) * 2; // [-1, 1]
  return Math.max(-cap, Math.min(cap, centered * cap));
}
