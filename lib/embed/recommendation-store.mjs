/**
 * lib/embed/recommendation-store.mjs — Durable recommendation memory
 * with deduplication and prioritization scoring.
 *
 * Tracks artifact recommendations across daemon lifecycle cycles so the
 * same recommendation isn't surfaced repeatedly. Supports explicit
 * dismissal, automatic suppression after 7 days, and re-surfacing when
 * new signals arrive.
 *
 * Construct now uses embedded LanceDB for vectors; recommendations
 * remain filesystem-primary for simplicity and Git-backed collaboration.
 *
 * Storage (project-scoped, the common case — a rootDir/project is given):
 *   <project>/.construct/intake/recommendations.jsonl — append-only log
 *   <project>/.construct/intake/recommendations-index.json — fast lookup by id
 * Storage (no project given — global fallback via lib/paths.mjs cxDir(), still
 * genuinely `~/.cx`, not yet migrated to `~/.construct`):
 *   ~/.cx/intake/recommendations.jsonl
 *   ~/.cx/intake/recommendations-index.json
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { emitBestEffort } from '../roles/event-bus.mjs';
import { cxDir } from '../paths.mjs';
import { configPath } from '../config-dir.mjs';

const DEFAULT_SUPPRESS_DAYS = 7;
const SUPERSEDE_WITHIN_HOURS = 72;

function recommendationPaths({ rootDir, project } = {}) {
  const baseDir = rootDir || project;
  const storeDir = baseDir ? configPath(baseDir, 'intake') : join(cxDir(), 'intake');
  return {
    storeDir,
    logFile: join(storeDir, 'recommendations.jsonl'),
    indexFile: join(storeDir, 'recommendations-index.json'),
  };
}

/**
 * Ensure store directory exists.
 */
function ensureDir(opts = {}) {
  const { storeDir } = recommendationPaths(opts);
  if (!existsSync(storeDir)) mkdirSync(storeDir, { recursive: true });
}

/**
 * Read the index (fast lookup).
 */
function readIndex(opts = {}) {
  const { indexFile } = recommendationPaths(opts);
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
function writeIndex(index, opts = {}) {
  const { indexFile } = recommendationPaths(opts);
  ensureDir(opts);
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
 */
function dedupKey(type, title) {
  return `${type}::${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60)}`;
}

/**
 * Create a recommendation.
 */
export function createRecommendation({ type, title, reason, signalCount = 1, customerImpact = 0, recencyBonus = 0, strategicBonus = 0, sourceSignalIds = [], lane, project, env }) {
  if (!type || !title) throw new Error('type and title are required');

  const pathOpts = { rootDir: project };
  ensureDir(pathOpts);
  const key = dedupKey(type, title);
  const index = readIndex(pathOpts);

  if (index[key]) {
    const existing = index[key];
    if (!existing.supersededAt) {
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
      writeIndex(index, pathOpts);

      return { id: existing.id, dedupKey: key, priority: updated.priority, score, existing: true, updatedAt: updated.lastSeen };
    }
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
    state: 'raw',
    enrichedAt: null,
    enrichedBy: null,
  };

  appendFileSync(recommendationPaths(pathOpts).logFile, JSON.stringify(rec) + '\n', 'utf8');

  index[key] = rec;
  writeIndex(index, pathOpts);

  emitBestEffort('recommendation.generated', {
    project: project || '',
    summary: `${rec.type}: ${rec.title}`,
    context: {
      recommendationId: rec.id,
      dedupKey: key,
      priority: rec.priority,
      score: rec.score,
      artifactType: rec.type,
    },
  });

  return { id, dedupKey: key, priority: rec.priority, score, existing: false };
}

function computeScore({ signalCount = 1, customerImpact = 0, recencyBonus = 0, strategicBonus = 0 }) {
  return (signalCount * 2) + (customerImpact * 3) + (recencyBonus) + (strategicBonus);
}

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
 * List active recommendations (filesystem-only).
 */
export function listActiveRecommendations({ type, priority, limit = 20, project, env } = {}) {
  const index = readIndex({ rootDir: project });
  const now = new Date();
  let results = Object.values(index).filter(rec => {
    if (rec.dismissedAt) {
      if (rec.suppressedUntil && new Date(rec.suppressedUntil) > now) return false;
      if (!rec.suppressedUntil) return false;
    }
    if (rec.supersededAt) return false;
    if (rec.suppressedUntil && new Date(rec.suppressedUntil) > now) return false;
    return true;
  });

  if (type) results = results.filter(r => r.type === type);
  if (priority) results = results.filter(r => r.priority === priority);

  return results
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .slice(0, limit);
}

export function autoSuppressStale({ project } = {}) {
  const pathOpts = { rootDir: project };
  const index = readIndex(pathOpts);
  const now = Date.now();
  let suppressed = 0;

  for (const [key, rec] of Object.entries(index)) {
    if (rec.dismissedAt || rec.supersededAt) continue;

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

  if (suppressed) writeIndex(index, pathOpts);
  return suppressed;
}

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
    recencyBonus: 3,
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

export function recommendationStats({ project } = {}) {
  const index = readIndex({ rootDir: project });
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

export function isRecommendationActive(type, title, { project } = {}) {
  const key = dedupKey(type, title);
  const index = readIndex({ rootDir: project });
  const rec = index[key];
  if (!rec) return { active: false, existing: null };
  if (rec.dismissedAt || rec.supersededAt) return { active: false, existing: rec };
  return { active: true, existing: rec };
}
