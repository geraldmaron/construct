/**
 * lib/cost-ledger.mjs — per-worker profile / per-day token-spend ledger.
 *
 * Tracks Claude API spend so the gateway can hard-stop worker profile invocations
 * before they blow the daily budget. Separate from lib/perspectives/ because both
 * the gateway and the cost watcher consume it.
 *
 * Storage: <doctorRoot>/cost-ledger.json — small JSON object keyed by `<dayKey>:<workerProfileId>`.
 * Rotates: entries older than 30 days are pruned on each write.
 *
 * Budgets are env-driven defaults; explicit `CONSTRUCT_BUDGET_<PERSONA>` wins.
 *   CONSTRUCT_BUDGET_DEFAULT     — per Worker Profile, USD/day (default 1.00)
 *   CONSTRUCT_BUDGET_TOTAL       — across all worker profiles, USD/day (default 10.00)
 *   CONSTRUCT_BUDGET_<PERSONA>   — specific worker profile override (uppercase, dashes → underscores)
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { cwd as procCwd } from 'node:process';

import { parseJsonc } from './jsonc.mjs';

import { doctorRoot } from './config/xdg.mjs';

const PRUNE_DAYS = 30;
const DEFAULT_PER_PERSONA = 10.0;
const DEFAULT_TOTAL = 50.0;

function rootDir() {
  return doctorRoot();
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

export function recordSpend({ workerProfileId, tokens = 0, costUsd = 0, sessionId = '', ts = Date.now() }) {
  if (process.env.CONSTRUCT_ROLES === 'off') return null;
  const state = load();
  const tsMs = typeof ts === 'string' ? Date.parse(ts) : Number(ts);
  const bucketTs = Number.isFinite(tsMs) && tsMs > 0 ? tsMs : Date.now();
  const key = `${dayKey(bucketTs)}:${workerProfileId || 'unknown'}`;
  const entry = state[key] || { tokens: 0, costUsd: 0, invocations: 0, sessions: [] };
  entry.tokens += tokens;
  entry.costUsd += costUsd;
  entry.invocations += 1;
  if (sessionId && !entry.sessions.includes(sessionId)) entry.sessions.push(sessionId);
  state[key] = entry;
  save(state);
  return entry;
}

export function getDailySpend({ workerProfileId, ts = Date.now() } = {}) {
  const state = load();
  const key = `${dayKey(ts)}:${workerProfileId || 'unknown'}`;
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

export function getDailySpendByWorkerProfile({ ts = Date.now() } = {}) {
  const state = load();
  const dk = dayKey(ts);
  const out = {};
  for (const [key, value] of Object.entries(state)) {
    const [day, workerProfileId] = key.split(':');
    if (day === dk && workerProfileId) out[workerProfileId] = value;
  }
  return out;
}

function envBudget(name, fallback) {
  const v = parseFloat(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

// Reads construct.config.json.costs.budgets at lookup time. JSON wins
// when set; env vars are back-compat fallback. Loader is best-effort
// — config errors fall through to env / default so budget checks never
// throw on a malformed file.
function configBudgetValue(keyPath) {
  try {
    const cfgPath = join(procCwd(), 'construct.config.json');
    if (!existsSync(cfgPath)) return null;
    const cfg = parseJsonc(readFileSync(cfgPath, 'utf8'));
    let cur = cfg;
    for (const part of keyPath.split('.')) {
      if (cur === null || typeof cur !== 'object') return null;
      cur = cur[part];
    }
    const n = Number(cur);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch { return null; }
}

export function workerProfileBudget(workerProfileId) {
  const envName = `CONSTRUCT_BUDGET_${String(workerProfileId || '').toUpperCase().replace(/-/g, '_')}`;
  const specific = parseFloat(process.env[envName]);
  if (Number.isFinite(specific) && specific > 0) return specific;
  const fromConfig = configBudgetValue(`costs.budgets.${workerProfileId}.dailyUsd`);
  if (fromConfig) return fromConfig;
  const fromConfigDefault = configBudgetValue('costs.budgets.default.dailyUsd');
  if (fromConfigDefault) return fromConfigDefault;
  return envBudget('CONSTRUCT_BUDGET_DEFAULT', DEFAULT_PER_PERSONA);
}

export function totalBudget() {
  const envVal = parseFloat(process.env.CONSTRUCT_BUDGET_TOTAL);
  if (Number.isFinite(envVal) && envVal > 0) return envVal;
  const fromConfig = configBudgetValue('costs.budgets.total.dailyUsd');
  if (fromConfig) return fromConfig;
  return DEFAULT_TOTAL;
}

export function enforcementActive() {
  if (process.env.CONSTRUCT_BUDGET_ENFORCE === 'on') return true;
  if (process.env.CONSTRUCT_BUDGET_ENFORCE === 'off') return false;
  try {
    const cfgPath = join(procCwd(), 'construct.config.json');
    if (!existsSync(cfgPath)) return false;
    const cfg = parseJsonc(readFileSync(cfgPath, 'utf8'));
    return Boolean(cfg?.costs?.enforce);
  } catch { return false; }
}

export function checkBudget({ workerProfileId }) {
  // Default to advisory-only. Hard-stop when CONSTRUCT_BUDGET_ENFORCE=on or
  // construct.config.json.costs.enforce=true. Ledger still records and
  // reports spend in both modes so over-budget shows up in the doctor
  // report regardless.
  if (!enforcementActive()) {
    return { allowed: true, reason: 'enforcement-advisory' };
  }
  const profileSpend = getDailySpend({ workerProfileId });
  const profileCap = workerProfileBudget(workerProfileId);
  if (profileSpend.costUsd >= profileCap) {
    return { allowed: false, reason: 'worker-profile-budget-exhausted', spent: profileSpend.costUsd, cap: profileCap };
  }
  const total = getTotalDailySpend();
  const totalCap = totalBudget();
  if (total.costUsd >= totalCap) {
    return { allowed: false, reason: 'total-budget-exhausted', spent: total.costUsd, cap: totalCap };
  }
  const warnAt = 0.8;
  let warning = null;
  if (profileSpend.costUsd / profileCap >= warnAt) {
    warning = `worker profile ${workerProfileId} at ${Math.round((profileSpend.costUsd / profileCap) * 100)}% of $${profileCap.toFixed(2)} daily cap`;
  } else if (total.costUsd / totalCap >= warnAt) {
    warning = `total spend at ${Math.round((total.costUsd / totalCap) * 100)}% of $${totalCap.toFixed(2)} daily cap`;
  }
  return { allowed: true, reason: 'within-budget', warning };
}

export const _paths = { rootDir, ledgerPath };
