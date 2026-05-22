/**
 * lib/embed/recommendation-store.mjs — Durable recommendation memory
 * with deduplication and prioritization scoring.
 *
 * Tracks artifact recommendations across daemon lifecycle cycles so the
 * same recommendation isn't surfaced repeatedly. Supports explicit
 * dismissal, automatic suppression after 7 days, and re-surfacing when
 * new signals arrive.
 *
 * Storage (solo mode):
 *   ~/.cx/intake/recommendations.jsonl — append-only log
 *   ~/.cx/intake/recommendations-index.json — fast lookup by id
 *
 * Storage (team/enterprise mode — DATABASE_URL configured):
 *   construct_recommendations table in Postgres (see db/schema/004_recommendations.sql)
 *   JSONL store is also written as a local backup.
 *
 * Prioritization formula:
 *   score = (signalCount * 2) + (customerImpact * 3) + (recencyBonus) + (strategicBonus)
 *   P0: score >= 10, P1: >= 7, P2: >= 4, P3: < 4
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { cxDir } from '../paths.mjs';
import { hasSqlStore } from '../storage/sql-store.mjs';
import { createSqlClient } from '../storage/backend.mjs';

const DEFAULT_SUPPRESS_DAYS = 7;
const SUPERSEDE_WITHIN_HOURS = 72;

function recommendationPaths() {
  const storeDir = join(cxDir(), 'intake');
  return {
    storeDir,
    logFile: join(storeDir, 'recommendations.jsonl'),
    indexFile: join(storeDir, 'recommendations-index.json'),
  };
}

/**
 * Ensure store directory exists.
 */
function ensureDir() {
  const { storeDir } = recommendationPaths();
  if (!existsSync(storeDir)) mkdirSync(storeDir, { recursive: true });
}

/**
 * Read the index (fast lookup).
 */
function readIndex() {
  const { indexFile } = recommendationPaths();
  if (!existsSync(indexFile)) return {};
  try {
    return JSON.parse(readFileSync(indexFile, 'utf8'));
  } catch {
    return {};
  }
}

/**
 * Write the index.
 */
function writeIndex(index) {
  const { indexFile } = recommendationPaths();
  ensureDir();
  writeFileSync(indexFile, JSON.stringify(index, null, 2) + '\n');
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
 * @param {string} [opts.project] - Project name (defaults to CX_PROJECT or 'default')
 * @param {object} [opts.env] - Environment (defaults to process.env)
 * @returns {{ id: string, dedupKey: string, priority: string, score: number }}
 */
export function createRecommendation({ type, title, reason, signalCount = 1, customerImpact = 0, recencyBonus = 0, strategicBonus = 0, sourceSignalIds = [], lane, project, env }) {
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

      const result = { id: existing.id, dedupKey: key, priority: updated.priority, score, existing: true, updatedAt: updated.lastSeen };
      createRecommendationPgBestEffort(updated, project, env);
      return result;
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
  appendFileSync(recommendationPaths().logFile, JSON.stringify(rec) + '\n', 'utf8');

  // Update index
  index[key] = rec;
  writeIndex(index);

  createRecommendationPgBestEffort(rec, project, env);
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
 * Supersede a recommendation (mark as superseded by a newer one).
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
 * In team/enterprise mode (DATABASE_URL configured), reads from Postgres when
 * the project has rows. Falls back to JSONL index.
 *
 * @param {object} [opts]
 * @param {string} [opts.type] - Filter by type
 * @param {string} [opts.priority] - Filter by priority (P0, P1, etc.)
 * @param {number} [opts.limit=20]
 * @param {string} [opts.project] - Project name (defaults to CX_PROJECT or 'default')
 * @param {object} [opts.env] - Environment (defaults to process.env)
 * @returns {Array<object>}
 */
export function listActiveRecommendations({ type, priority, limit = 20, project, env } = {}) {
  if (hasSqlStore(env)) {
    return listActiveRecommendationsPgWithFallback({ type, priority, limit, project, env });
  }
  return listActiveRecommendationsFile({ type, priority, limit });
}

/**
 * File-based active recommendations list.
 */
function listActiveRecommendationsFile({ type, priority, limit = 20 } = {}) {
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
 * Attempt Postgres read, fall back to file synchronously.
 * Returns a Promise so callers using await get Postgres data; callers not
 * using await get the file-based results via the sync fallback.
 */
function listActiveRecommendationsPgWithFallback({ type, priority, limit, project, env }) {
  const resolvedProject = project || (env || process.env).CX_PROJECT || 'default';
  const client = createSqlClient(env);

  return listActiveRecommendationsPg(resolvedProject, { type, priority, limit }, client)
    .then(rows => {
      client.end({ timeout: 5 }).catch(() => {});
      if (rows.length > 0) return rows;
      return listActiveRecommendationsFile({ type, priority, limit });
    })
    .catch(() => {
      client.end({ timeout: 5 }).catch(() => {});
      return listActiveRecommendationsFile({ type, priority, limit });
    });
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

// ---------------------------------------------------------------------------
// Postgres backend — team/enterprise mode only
// ---------------------------------------------------------------------------

/**
 * Upsert a recommendation into construct_recommendations.
 * On conflict (project, dedup_key) update all mutable fields.
 *
 * @param {object} rec - Recommendation object (camelCase)
 * @param {string} project
 * @param {object} client - postgres.js SQL client
 */
export async function createRecommendationPg(rec, project, client) {
  await client`
    insert into construct_recommendations (
      id, project, dedup_key, type, title, reason, lane,
      signal_count, total_signal_count,
      customer_impact, recency_bonus, strategic_bonus,
      score, priority, source_signal_ids,
      first_seen, last_seen,
      dismissed_at, dismiss_reason,
      superseded_at, superseded_by_id,
      suppressed_until, suppress_reason,
      updated_at
    ) values (
      ${rec.id}, ${project}, ${rec.dedupKey || dedupKey(rec.type, rec.title)}, ${rec.type}, ${rec.title},
      ${rec.reason ?? null}, ${rec.lane ?? null},
      ${rec.signalCount ?? 1}, ${rec.totalSignalCount ?? 1},
      ${rec.customerImpact ?? 0}, ${rec.recencyBonus ?? 0}, ${rec.strategicBonus ?? 0},
      ${rec.score ?? 0}, ${rec.priority ?? 'P3'},
      ${JSON.stringify(rec.sourceSignalIds ?? [])}::jsonb,
      ${rec.firstSeen ?? new Date().toISOString()}, ${rec.lastSeen ?? new Date().toISOString()},
      ${rec.dismissedAt ?? null}, ${rec.dismissReason ?? null},
      ${rec.supersededAt ?? null}, ${rec.supersededById ?? null},
      ${rec.suppressedUntil ?? null}, ${rec.suppressReason ?? null},
      now()
    )
    on conflict (project, dedup_key) do update set
      signal_count        = excluded.signal_count,
      total_signal_count  = excluded.total_signal_count,
      customer_impact     = excluded.customer_impact,
      recency_bonus       = excluded.recency_bonus,
      strategic_bonus     = excluded.strategic_bonus,
      score               = excluded.score,
      priority            = excluded.priority,
      source_signal_ids   = excluded.source_signal_ids,
      last_seen           = excluded.last_seen,
      dismissed_at        = excluded.dismissed_at,
      dismiss_reason      = excluded.dismiss_reason,
      superseded_at       = excluded.superseded_at,
      superseded_by_id    = excluded.superseded_by_id,
      suppressed_until    = excluded.suppressed_until,
      suppress_reason     = excluded.suppress_reason,
      updated_at          = now()
  `;
}

/**
 * Query active recommendations from Postgres for a project.
 *
 * @param {string} project
 * @param {object} [opts]
 * @param {string} [opts.type]
 * @param {string} [opts.priority]
 * @param {number} [opts.limit=20]
 * @param {object} client - postgres.js SQL client
 * @returns {Promise<Array<object>>}
 */
export async function listActiveRecommendationsPg(project, { type, priority, limit = 20 } = {}, client) {
  const rows = await client`
    select *
    from construct_recommendations
    where project = ${project}
      and dismissed_at is null
      and superseded_at is null
      and (suppressed_until is null or suppressed_until <= now())
      ${type ? client`and type = ${type}` : client``}
      ${priority ? client`and priority = ${priority}` : client``}
    order by score desc
    limit ${limit}
  `;

  return rows.map(row => ({
    id: row.id,
    type: row.type,
    title: row.title,
    reason: row.reason,
    lane: row.lane,
    signalCount: row.signal_count,
    totalSignalCount: row.total_signal_count,
    customerImpact: row.customer_impact,
    recencyBonus: row.recency_bonus,
    strategicBonus: row.strategic_bonus,
    score: row.score,
    priority: row.priority,
    sourceSignalIds: row.source_signal_ids ?? [],
    firstSeen: row.first_seen instanceof Date ? row.first_seen.toISOString() : row.first_seen,
    lastSeen: row.last_seen instanceof Date ? row.last_seen.toISOString() : row.last_seen,
    dismissedAt: row.dismissed_at,
    supersededAt: row.superseded_at,
    suppressedUntil: row.suppressed_until,
  }));
}

/**
 * Dismiss a recommendation in Postgres.
 *
 * @param {string} dedupKeyValue
 * @param {string} project
 * @param {object} [opts]
 * @param {string} [opts.reason]
 * @param {number} [opts.suppressDays]
 * @param {object} client - postgres.js SQL client
 */
export async function dismissRecommendationPg(dedupKeyValue, project, { reason = 'manually dismissed', suppressDays } = {}, client) {
  const suppressedUntil = suppressDays
    ? new Date(Date.now() + suppressDays * 24 * 60 * 60 * 1000).toISOString()
    : null;

  await client`
    update construct_recommendations
    set
      dismissed_at    = now(),
      dismiss_reason  = ${reason},
      suppressed_until = ${suppressedUntil},
      updated_at      = now()
    where project = ${project}
      and dedup_key = ${dedupKeyValue}
  `;
}

/**
 * Fire-and-forget Postgres upsert — never throws, never blocks the caller.
 */
function createRecommendationPgBestEffort(rec, project, env) {
  if (!hasSqlStore(env)) return;
  const resolvedProject = project || (env || process.env).CX_PROJECT || 'default';
  const client = createSqlClient(env);
  createRecommendationPg(rec, resolvedProject, client)
    .catch(() => {})
    .finally(() => client.end({ timeout: 5 }).catch(() => {}));
}
