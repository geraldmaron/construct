/**
 * lib/cost-ledger.mjs — per-persona / per-day token-spend ledger.
 *
 * Tracks Claude API spend so the gateway can hard-stop persona invocations
 * before they blow the daily budget. Separate from lib/roles/ because both
 * the gateway and the cost watcher consume it.
 *
 * Storage: ~/.cx/cost-ledger.json — small JSON object keyed by `<dayKey>:<personaId>`.
 * Rotates: entries older than 30 days are pruned on each write.
 *
 * Budgets are env-driven defaults; explicit `CONSTRUCT_BUDGET_<PERSONA>` wins.
 *   CONSTRUCT_BUDGET_DEFAULT     — per persona, USD/day (default 1.00)
 *   CONSTRUCT_BUDGET_TOTAL       — across all personas, USD/day (default 10.00)
 *   CONSTRUCT_BUDGET_<PERSONA>   — specific persona override (uppercase, dashes → underscores)
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const PRUNE_DAYS = 30;
const DEFAULT_PER_PERSONA = 10.0;
const DEFAULT_TOTAL = 50.0;

function rootDir() {
  return process.env.CONSTRUCT_DOCTOR_ROOT || join(homedir(), '.cx');
}
function ledgerPath() {
  return join(rootDir(), 'cost-ledger.json');
}
function ensureDir() {
  const r = rootDir();
  if (!existsSync(r)) mkdirSync(r, { recursive: true });
}

export function dayKey(ts = Date.now()) {
  const d = new Date(ts);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function load() {
  const p = ledgerPath();
  if (!existsSync(p)) return {};
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return {}; }
}

function save(state) {
  ensureDir();
  const cutoff = dayKey(Date.now() - PRUNE_DAYS * 24 * 60 * 60 * 1000);
  const trimmed = {};
  for (const [key, value] of Object.entries(state)) {
    const k = key.split(':')[0];
    if (k >= cutoff) trimmed[key] = value;
  }
  writeFileSync(ledgerPath(), JSON.stringify(trimmed));
}

export function recordSpend({ personaId, tokens = 0, costUsd = 0, sessionId = '', ts = Date.now() }) {
  if (process.env.CONSTRUCT_ROLES === 'off') return null;
  const state = load();
  const tsMs = typeof ts === 'string' ? Date.parse(ts) : Number(ts);
  const bucketTs = Number.isFinite(tsMs) && tsMs > 0 ? tsMs : Date.now();
  const key = `${dayKey(bucketTs)}:${personaId || 'unknown'}`;
  const entry = state[key] || { tokens: 0, costUsd: 0, invocations: 0, sessions: [] };
  entry.tokens += tokens;
  entry.costUsd += costUsd;
  entry.invocations += 1;
  if (sessionId && !entry.sessions.includes(sessionId)) entry.sessions.push(sessionId);
  state[key] = entry;
  save(state);
  return entry;
}

export function getDailySpend({ personaId, ts = Date.now() } = {}) {
  const state = load();
  const key = `${dayKey(ts)}:${personaId || 'unknown'}`;
  return state[key] || { tokens: 0, costUsd: 0, invocations: 0, sessions: [] };
}

export function getTotalDailySpend({ ts = Date.now() } = {}) {
  const state = load();
  const dk = dayKey(ts);
  let total = { tokens: 0, costUsd: 0, invocations: 0 };
  for (const [key, value] of Object.entries(state)) {
    if (key.startsWith(dk + ':')) {
      total.tokens += value.tokens;
      total.costUsd += value.costUsd;
      total.invocations += value.invocations;
    }
  }
  return total;
}

function envBudget(name, fallback) {
  const v = parseFloat(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

export function personaBudget(personaId) {
  const envName = `CONSTRUCT_BUDGET_${String(personaId || '').toUpperCase().replace(/-/g, '_')}`;
  const specific = parseFloat(process.env[envName]);
  if (Number.isFinite(specific) && specific > 0) return specific;
  return envBudget('CONSTRUCT_BUDGET_DEFAULT', DEFAULT_PER_PERSONA);
}

export function totalBudget() {
  return envBudget('CONSTRUCT_BUDGET_TOTAL', DEFAULT_TOTAL);
}

export function checkBudget({ personaId }) {
  // Default to advisory-only. Hard-stop only when CONSTRUCT_BUDGET_ENFORCE=on
  // is explicitly set. Cost ledger still records and reports spend in both
  // modes so over-budget shows up in the doctor report regardless.
  if (process.env.CONSTRUCT_BUDGET_ENFORCE !== 'on') {
    return { allowed: true, reason: 'enforcement-advisory' };
  }
  const personaSpend = getDailySpend({ personaId });
  const personaCap = personaBudget(personaId);
  if (personaSpend.costUsd >= personaCap) {
    return { allowed: false, reason: 'persona-budget-exhausted', spent: personaSpend.costUsd, cap: personaCap };
  }
  const total = getTotalDailySpend();
  const totalCap = totalBudget();
  if (total.costUsd >= totalCap) {
    return { allowed: false, reason: 'total-budget-exhausted', spent: total.costUsd, cap: totalCap };
  }
  const warnAt = 0.8;
  let warning = null;
  if (personaSpend.costUsd / personaCap >= warnAt) {
    warning = `persona ${personaId} at ${Math.round((personaSpend.costUsd / personaCap) * 100)}% of $${personaCap.toFixed(2)} daily cap`;
  } else if (total.costUsd / totalCap >= warnAt) {
    warning = `total spend at ${Math.round((total.costUsd / totalCap) * 100)}% of $${totalCap.toFixed(2)} daily cap`;
  }
  return { allowed: true, reason: 'within-budget', warning };
}

export const _paths = { rootDir, ledgerPath };
