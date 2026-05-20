/**
 * lib/embed/recommendation-store.mjs — Durable recommendation memory
 * with deduplication and prioritization scoring.
 *
 * Tracks artifact recommendations across daemon lifecycle cycles so the
 * same recommendation isn't surfaced repeatedly. Supports explicit
 * dismissal, automatic suppression after 7 days, and re-surfacing when
 * new signals arrive.
 *
 * Storage:
 *   ~/.cx/intake/recommendations.jsonl — append-only log
 *   ~/.cx/intake/recommendations-index.json — fast lookup by id
 *
 * Prioritization formula:
 *   score = (signalCount * 2) + (customerImpact * 3) + (recencyBonus) + (strategicBonus)
 *   P0: score >= 10, P1: >= 7, P2: >= 4, P3: < 4
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';

const STORE_DIR = join(homedir(), '.cx', 'intake');
const LOG_FILE = join(STORE_DIR, 'recommendations.jsonl');
const INDEX_FILE = join(STORE_DIR, 'recommendations-index.json');

const DEFAULT_SUPPRESS_DAYS = 7;
const SUPERSEDE_WITHIN_HOURS = 72;

/**
 * Ensure store directory exists.
 */
function ensureDir() {
  if (!existsSync(STORE_DIR)) mkdirSync(STORE_DIR, { recursive: true });
}

/**
 * Read the index (fast lookup).
 */
function readIndex() {
  if (!existsSync(INDEX_FILE)) return {};
  try {
    return JSON.parse(readFileSync(INDEX_FILE, 'utf8'));
  } catch {
    return {};
  }
}

/**
 * Write the index.
 */
function writeIndex(index) {
  ensureDir();
  writeFileSync(INDEX_FILE, JSON.stringify(index, null, 2) + '\n');
}

/**
 * Compute priority tier from score.
 */
function priorityTier(score) {
  if (score >= 10) return 'P0';
  if (score >= 7) return 'P1';
  if (score >= 4) return 'P2';
  return 'P3';
}

/**
 * Compute a dedup key from recommendation properties.
 * Two recommendations with the same dedup key are considered identical.
 */
function dedupKey(type, title) {
  return `${type}::${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60)}`;
}

/**
 * Create a recommendation.
 *
 * @param {object} opts
 * @param {string} opts.type - 'prd' | 'adr' | 'rfc' | 'runbook' | 'postmortem'
 * @param {string} opts.title - Human-readable title
 * @param {string} opts.reason - Why this is being recommended
 * @param {number} [opts.signalCount=1] - Number of signals triggering this
 * @param {number} [opts.customerImpact=0] - 0-3: how many customers affected
 * @param {number} [opts.recencyBonus=0] - 0-3: how recent the signals are
 * @param {number} [opts.strategicBonus=0] - 0-3: strategic alignment
 * @param {string[]} [opts.sourceSignalIds] - IDs of intake signals that triggered this
 * @param {string} [opts.lane] - Docs lane this belongs to
 * @returns {{ id: string, dedupKey: string, priority: string, score: number }}
 */
export function createRecommendation({ type, title, reason, signalCount = 1, customerImpact = 0, recencyBonus = 0, strategicBonus = 0, sourceSignalIds = [], lane }) {
  if (!type || !title) throw new Error('type and title are required');

  ensureDir();
  const key = dedupKey(type, title);
  const index = readIndex();

  // Check if already exists (dedup)
  if (index[key]) {
    const existing = index[key];
    if (!existing.supersededAt) {
      // Update existing — increment signal count, extend dates
      const updated = {
        ...existing,
        lastSeen: new Date().toISOString(),
        totalSignalCount: (existing.totalSignalCount || 0) + signalCount,
        signalCount: (existing.signalCount || 0) + signalCount,
        lastSignals: sourceSignalIds.slice(0, 5),
        customerImpact: Math.max(existing.customerImpact || 0, customerImpact),
        recencyBonus: Math.max(existing.recencyBonus || 0, recencyBonus),
      };
      const score = computeScore(updated);
      updated.score = score;
      updated.priority = priorityTier(score);
      index[key] = updated;
      writeIndex(index);
      return { id: existing.id, dedupKey: key, priority: updated.priority, score, existing: true, updatedAt: updated.lastSeen };
    }
    // Existing was dismissed — create new instance with new signals
    // (superseded recommendations can be revived with fresh signals)
  }

  const id = `rec-${randomUUID().slice(0, 8)}`;
  const score = computeScore({ signalCount, customerImpact, recencyBonus, strategicBonus });
  const rec = {
    id,
    type,
    title,
    reason,
    lane: lane || `${type}s`,
    signalCount,
    totalSignalCount: signalCount,
    customerImpact,
    recencyBonus,
    strategicBonus,
    score,
    priority: priorityTier(score),
    sourceSignalIds: sourceSignalIds.slice(0, 10),
    firstSeen: new Date().toISOString(),
    lastSeen: new Date().toISOString(),
    dismissedAt: null,
    supersededAt: null,
    supersededById: null,
    suppressedUntil: null,
  };

  // Append to log
  appendFileSync(LOG_FILE, JSON.stringify(rec) + '\n', 'utf8');

  // Update index
  index[key] = rec;
  writeIndex(index);

  return { id, dedupKey: key, priority: rec.priority, score, existing: false };
}

/**
 * Compute prioritization score.
 * score = (signalCount * 2) + (customerImpact * 3) + (recencyBonus) + (strategicBonus)
 */
function computeScore({ signalCount = 1, customerImpact = 0, recencyBonus = 0, strategicBonus = 0 }) {
  return (signalCount * 2) + (customerImpact * 3) + (recencyBonus) + (strategicBonus);
}

/**
 * Dismiss a recommendation (suppress permanently or for N days).
 *
 * @param {string} dedupKey - Dedup key
 * @param {object} [opts]
 * @param {string} [opts.reason] - Why dismissed
 * @param {number} [opts.suppressDays] - Days to suppress (default: forever)
 * @returns {{ success: boolean }}
 */
export function dismissRecommendation(dedupKey, { reason = 'manually dismissed', suppressDays } = {}) {
  const index = readIndex();
  if (!index[dedupKey]) {
    throw new Error(`Recommendation not found: ${dedupKey}`);
  }

  index[dedupKey] = {
    ...index[dedupKey],
    dismissedAt: new Date().toISOString(),
    dismissReason: reason,
    suppressedUntil: suppressDays
      ? new Date(Date.now() + suppressDays * 24 * 60 * 60 * 1000).toISOString()
      : null,
  };

  writeIndex(index);
  return { success: true };
}

/**
 * Supersede a recommendation (mark as replaced by a newer one).
 *
 * @param {string} dedupKey - Existing recommendation to supersede
 * @param {string} supersedingId - ID of the recommendation that replaces it
 * @returns {{ success: boolean }}
 */
export function supersedeRecommendation(dedupKey, supersedingId) {
  const index = readIndex();
  if (!index[dedupKey]) {
    throw new Error(`Recommendation not found: ${dedupKey}`);
  }

  index[dedupKey] = {
    ...index[dedupKey],
    supersededAt: new Date().toISOString(),
    supersededById: supersedingId,
  };

  writeIndex(index);
  return { success: true };
}

/**
 * List active (non-dismissed, non-superseded) recommendations.
 *
 * @param {object} [opts]
 * @param {string} [opts.type] - Filter by type
 * @param {string} [opts.priority] - Filter by priority (P0, P1, etc.)
 * @param {number} [opts.limit=20]
 * @returns {Array<object>}
 */
export function listActiveRecommendations({ type, priority, limit = 20 } = {}) {
  const index = readIndex();
  const now = new Date();
  let results = Object.values(index).filter(rec => {
    // Skip dismissed (unless temporary suppress and still active)
    if (rec.dismissedAt) {
      if (rec.suppressedUntil && new Date(rec.suppressedUntil) > now) return false;
      if (!rec.suppressedUntil) return false;
    }
    // Skip superseded
    if (rec.supersededAt) return false;
    // Skip suppressed
    if (rec.suppressedUntil && new Date(rec.suppressedUntil) > now) return false;
    return true;
  });

  if (type) results = results.filter(r => r.type === type);
  if (priority) results = results.filter(r => r.priority === priority);

  return results
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .slice(0, limit);
}

/**
 * Auto-suppress recommendations that have been active for DEFAULT_SUPPRESS_DAYS
 * without new signals, or that were superseded more than SUPERSEDE_WITHIN_HOURS ago.
 * Call from docs-lifecycle or a scheduled daemon job.
 *
 * @returns {number} Number of recommendations suppressed
 */
export function autoSuppressStale() {
  const index = readIndex();
  const now = Date.now();
  let suppressed = 0;

  for (const [key, rec] of Object.entries(index)) {
    if (rec.dismissedAt || rec.supersededAt) continue;

    // Suppress if lastSeen is older than DEFAULT_SUPPRESS_DAYS
    const lastSeen = new Date(rec.lastSeen || rec.firstSeen).getTime();
    const ageDays = (now - lastSeen) / (24 * 60 * 60 * 1000);
    if (ageDays > DEFAULT_SUPPRESS_DAYS) {
      index[key] = {
        ...rec,
        suppressedUntil: new Date(now + DEFAULT_SUPPRESS_DAYS * 24 * 60 * 60 * 1000).toISOString(),
        suppressReason: 'stale',
      };
      suppressed++;
      continue;
    }

    // Suppress superseded older than threshold
    if (rec.supersededAt) {
      const supersededAt = new Date(rec.supersededAt).getTime();
      if ((now - supersededAt) > SUPERSEDE_WITHIN_HOURS * 60 * 60 * 1000) {
        index[key] = {
          ...rec,
          suppressedUntil: new Date(now + 30 * 24 * 60 * 60 * 1000).toISOString(),
          suppressReason: 'superseded',
        };
        suppressed++;
      }
    }
  }

  if (suppressed) writeIndex(index);
  return suppressed;
}

/**
 * Revive a recommendation from dismissal with new signals.
 *
 * @param {string} dedupKey
 * @param {object} newSignals
 * @param {number} [newSignals.signalCount=1]
 * @param {string[]} [newSignals.sourceSignalIds]
 * @returns {{ success: boolean }}
 */
export function reviveRecommendation(dedupKey, { signalCount = 1, sourceSignalIds = [] } = {}) {
  const index = readIndex();
  if (!index[dedupKey]) {
    throw new Error(`Recommendation not found: ${dedupKey}`);
  }

  const existing = index[dedupKey];
  const updatedSignalCount = (existing.totalSignalCount || 0) + signalCount;
  const score = computeScore({
    signalCount: updatedSignalCount,
    customerImpact: existing.customerImpact || 0,
    recencyBonus: 3, // recent signals get max recency bonus
    strategicBonus: existing.strategicBonus || 0,
  });

  index[dedupKey] = {
    ...existing,
    lastSeen: new Date().toISOString(),
    totalSignalCount: updatedSignalCount,
    signalCount,
    score,
    priority: priorityTier(score),
    sourceSignalIds: [...(existing.sourceSignalIds || []), ...sourceSignalIds].slice(0, 10),
    dismissedAt: null,
    suppressedUntil: null,
    dismissReason: null,
  };

  writeIndex(index);
  return { success: true };
}

/**
 * Get store statistics.
 *
 * @returns {{ total: number, active: number, dismissed: number, superseded: number, byPriority: object }}
 */
export function recommendationStats() {
  const index = readIndex();
  const entries = Object.values(index);
  const byPriority = {};
  let active = 0, dismissed = 0, superseded = 0;

  for (const rec of entries) {
    if (rec.dismissedAt) { dismissed++; continue; }
    if (rec.supersededAt) { superseded++; continue; }
    active++;
    byPriority[rec.priority] = (byPriority[rec.priority] || 0) + 1;
  }

  return {
    total: entries.length,
    active,
    dismissed,
    superseded,
    byPriority,
    byType: entries.reduce((acc, r) => { acc[r.type] = (acc[r.type] || 0) + 1; return acc; }, {}),
  };
}

/**
 * Check if a recommendation with the given dedup key is active.
 *
 * @param {string} type
 * @param {string} title
 * @returns {{ active: boolean, existing: object|null }}
 */
export function isRecommendationActive(type, title) {
  const key = dedupKey(type, title);
  const index = readIndex();
  const rec = index[key];
  if (!rec) return { active: false, existing: null };
  if (rec.dismissedAt || rec.supersededAt) return { active: false, existing: rec };
  return { active: true, existing: rec };
}
