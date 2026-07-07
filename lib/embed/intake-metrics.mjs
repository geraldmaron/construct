/**
 * lib/embed/intake-metrics.mjs — Intake pipeline observability.
 *
 * Aggregates volume, velocity, processing time, and acceptance rate from
 * the filesystem intake queue. Consumed by `construct intake metrics` and
 * MCP insight tools.
 *
 * Data sources:
 *   .construct/intake/pending/   — JSON files waiting for triage
 *   .construct/intake/processed/  — JSON files already handled
 *   .construct/intake/skipped/     — JSON files intentionally skipped
 *   ~/.cx/intake/recommendations-index.json — recommendations
 *
 * All read-only. Never writes to the intake queue.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { doctorRoot } from '../config/xdg.mjs';
import { configPath } from '../config-dir.mjs';

/**
 * Scan an intake directory and return file metadata.
 */
function scanDir(dir) {
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        const fp = join(dir, f);
        try {
          const stat = statSync(fp);
          const content = readFileSync(fp, 'utf8');
          const parsed = JSON.parse(content);
          return {
            id: f.replace('.json', ''),
            createdAt: parsed.createdAt || parsed.triage?.createdAt || stat.birthtime.toISOString(),
            size: stat.size,
            mtimeMs: stat.mtimeMs,
            triage: parsed.triage?.intakeType || 'unknown',
            owner: parsed.triage?.primaryOwner || '—',
            action: parsed.triage?.recommendedAction || '—',
            customers: parsed.customers?.length || 0,
          };
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  } catch {
    return [];
  }
}

/**
 * Compute metrics for an intake queue.
 *
 * @param {object} [opts]
 * @param {string} [opts.rootDir] - Project root (default: cwd)
 * @returns {object} Metrics summary
 */
export function computeIntakeMetrics({ rootDir } = {}) {
  const root = rootDir || process.cwd();
  const pendingDir = configPath(root, 'intake', 'pending');
  const processedDir = configPath(root, 'intake', 'processed');
  const skippedDir = configPath(root, 'intake', 'skipped');

  const pending = scanDir(pendingDir);
  const processed = scanDir(processedDir);
  const skipped = scanDir(skippedDir);

  // Volume
  const volume = {
    pending: pending.length,
    processed: processed.length,
    skipped: skipped.length,
    total: pending.length + processed.length + skipped.length,
  };

  // Velocity — items per day over trailing 7d window
  const now = Date.now();
  const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
  const allItems = [...pending, ...processed, ...skipped];
  const recentItems = allItems.filter(i => (now - new Date(i.createdAt).getTime()) < SEVEN_DAYS);
  const velocity = Number((recentItems.length / 7).toFixed(1));

  // Processing time — how long between creation and processing
  const processingTimes = [];
  for (const item of processed) {
    try {
      const fp = join(processedDir, `${item.id}.json`);
      const raw = JSON.parse(readFileSync(fp, 'utf8'));
      if (raw.createdAt && raw.processedAt) {
        const ms = new Date(raw.processedAt) - new Date(raw.createdAt);
        if (ms > 0) processingTimes.push(ms);
      }
    } catch { /* skip */ }
  }
  const avgProcessingTimeMs = processingTimes.length
    ? Math.round(processingTimes.reduce((s, t) => s + t, 0) / processingTimes.length)
    : null;

  // — By type breakdown
  const byType = {};
  for (const item of allItems) {
    byType[item.triage] = (byType[item.triage] || 0) + 1;
  }

  // — By owner breakdown
  const byOwner = {};
  for (const item of allItems) {
    byOwner[item.owner] = (byOwner[item.owner] || 0) + 1;
  }

  // — Acceptance rate (processed / total actionable)
  const actionable = volume.processed + volume.skipped;
  const acceptRate = actionable > 0
    ? Number((volume.processed / actionable * 100).toFixed(1))
    : null;

  // — Customer-linked items
  const customerLinked = allItems.filter(i => i.customers > 0).length;

  // — Metrics from recommendation store
  let recStats = { active: 0, dismissed: 0, total: 0 };
  try {
    const recIndexPath = join(doctorRoot(), 'intake', 'recommendations-index.json');
    if (existsSync(recIndexPath)) {
      const index = JSON.parse(readFileSync(recIndexPath, 'utf8'));
      const entries = Object.values(index);
      recStats = {
        total: entries.length,
        active: entries.filter(e => !e.dismissedAt && !e.supersededAt).length,
        dismissed: entries.filter(e => e.dismissedAt).length,
      };
    }
  } catch { /* skip */ }

  return {
    volume,
    velocity,
    recentItems: recentItems.length,
    avgProcessingTimeMs,
    avgProcessingTimeFormatted: avgProcessingTimeMs
      ? formatDuration(avgProcessingTimeMs)
      : null,
    byType,
    byOwner,
    acceptRate,
    customerLinked,
    recommendations: recStats,
    sampledAt: new Date().toISOString(),
  };
}

function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60000);
  const secs = Math.round((ms % 60000) / 1000);
  return `${mins}m ${secs}s`;
}

/**
 * Get the age of the oldest pending item.
 *
 * @param {object} [opts]
 * @param {string} [opts.rootDir]
 * @returns {{ oldest: string|null, ageHours: number|null, count: number }}
 */
export function pendingAge({ rootDir } = {}) {
  const root = rootDir || process.cwd();
  const pendingDir = configPath(root, 'intake', 'pending');
  const items = scanDir(pendingDir);
  if (!items.length) return { oldest: null, ageHours: null, count: 0 };

  const oldest = items.reduce((a, b) =>
    new Date(a.createdAt) < new Date(b.createdAt) ? a : b
  );
  const ageHours = (Date.now() - new Date(oldest.createdAt).getTime()) / (60 * 60 * 1000);

  return {
    oldest: oldest.id,
    oldestCreatedAt: oldest.createdAt,
    ageHours: Number(ageHours.toFixed(1)),
    count: items.length,
    oldItemsCount: items.filter(i => (Date.now() - new Date(i.createdAt).getTime()) > 24 * 60 * 60 * 1000).length,
  };
}
