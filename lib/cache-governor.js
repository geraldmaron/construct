/**
 * lib/cache-governor.js — Adaptive cache strategy feedback loop.
 *
 * Reads cost log, computes cache efficiency per provider.
 * Adjusts strategy based on observed vs expected cache usage.
 * Persists state in ~/.cx/cache-strategy.json.
 *
 * Runs as a PostToolUse hook (lightweight, sub-5ms).
 * Adjustments are persisted per-provider.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { normalizeCostEntry } from './cost.mjs';

const STRATEGY_PATH = join(homedir(), '.cx', 'cache-strategy.json');
const REVIEW_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes between adjustments

function readStrategy() {
  try {
    if (!existsSync(STRATEGY_PATH)) return {};
    return JSON.parse(readFileSync(STRATEGY_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function writeStrategy(data) {
  try {
    mkdirSync(join(homedir(), '.cx'), { recursive: true });
    writeFileSync(STRATEGY_PATH, JSON.stringify(data, null, 2));
  } catch { /* best effort */ }
}

/**
 * Compute cache efficiency from a cost entry.
 * Compares actual cache reads vs expected cacheable tokens.
 *
 * @param {object} entry - normalized cost entry
 * @param {number} expectedCacheableTokens
 * @returns {{ efficiency: number, waste: number, hitRate: number }}
 */
export function computeCacheEfficiency(entry, expectedCacheableTokens = 0) {
  if (!entry) return { efficiency: 0, waste: 0, hitRate: 0 };

  const actualCacheRead = entry.cacheReadInputTokens || 0;
  const actualCacheWrite = entry.cacheCreationInputTokens || 0;
  const processedInput = entry.processedInputTokens || entry.inputTokens || 0;

  const hitRate = processedInput > 0 ? actualCacheRead / processedInput : 0;
  const writeRatio = expectedCacheableTokens > 0
    ? actualCacheWrite / expectedCacheableTokens
    : 0;

  // Efficiency: how close are we to expected cache usage?
  const efficiency = expectedCacheableTokens > 0
    ? Math.min(1, actualCacheRead / expectedCacheableTokens)
    : 0;

  // Waste: expected writes minus actual reads (over-caching)
  const waste = Math.max(0, actualCacheWrite - actualCacheRead);

  return {
    efficiency: Math.round(efficiency * 100) / 100,
    waste,
    hitRate: Math.round(hitRate * 100) / 100,
    actualCacheRead,
    actualCacheWrite,
    expectedCacheableTokens,
  };
}

/**
 * Analyze recent cost entries and suggest cache strategy adjustments.
 *
 * @param {Array} entries - normalized cost entries
 * @param {string} provider
 * @returns {{ adjustBreakpoints: boolean, suggestion: string, reason: string }}
 */
export function analyzeCachePerformance(entries, provider) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return { adjustBreakpoints: false, suggestion: 'no data', reason: 'No cost entries' };
  }

  // Get latest entry with cache data
  const withCache = entries
    .filter(e => (e.cacheReadInputTokens || 0) > 0 || (e.cacheCreationInputTokens || 0) > 0)
    .sort((a, b) => new Date(b.ts || 0) - new Date(a.ts || 0));

  if (withCache.length === 0) {
    return { adjustBreakpoints: false, suggestion: 'no cache activity', reason: 'No cache reads/writes detected' };
  }

  const latest = withCache[0];
  const efficiency = computeCacheEfficiency(latest, latest.expectedCacheableTokens || 0);

  // Strategy rules
  if (efficiency.efficiency < 0.2 && (latest.expectedCacheableTokens || 0) > 0) {
    return {
      adjustBreakpoints: true,
      suggestion: 'shift later',
      reason: `Very low cache efficiency (${(efficiency.efficiency * 100).toFixed(1)}% — cache placement may be wrong`,
    };
  }

  if (efficiency.hitRate < 0.2 && (latest.expectedCacheableTokens || 0) > 0) {
    return {
      adjustBreakpoints: true,
      suggestion: 'add earlier breakpoints',
      reason: `Low cache hit rate (${(efficiency.hitRate * 100).toFixed(1)}% — try caching more static content`,
    };
  }

  if (efficiency.efficiency > 0.8) {
    return {
      adjustBreakpoints: false,
      suggestion: 'optimal',
      reason: `Good cache efficiency (${(efficiency.efficiency * 100).toFixed(1)}% — no adjustment needed`,
    };
  }

  if (efficiency.waste > 5000) {
    return {
      adjustBreakpoints: true,
      suggestion: 'reduce breakpoints',
      reason: `High cache waste (${efficiency.waste} tokens over-cached)`,
    };
  }

  return {
    adjustBreakpoints: false,
    suggestion: 'stable',
    reason: `Cache efficiency ${(efficiency.efficiency * 100).toFixed(1)}% — within normal range`,
  };
}

/**
 * PostToolUse hook entry point.
 * Reads cost log and adjusts strategy if needed.
 *
 * @param {object} opts - { costLogPath, provider, dryRun }
 * @returns {{ adjusted: boolean, strategy: object }}
 */
export function onPostToolUse({ costLogPath, provider, dryRun = false } = {}) {
  const strategy = readStrategy();

  // Check cooldown
  const lastReview = strategy[`${provider}:lastReview`] || 0;
  if (Date.now() - lastReview < REVIEW_INTERVAL_MS) {
    return { adjusted: false, reason: 'Cooldown active', strategy: strategy[provider] };
  }

  // Read cost log
  const entries = [];
  try {
    const logPath = costLogPath || join(homedir(), '.cx', 'session-cost.jsonl');
    if (!existsSync(logPath)) return { adjusted: false, reason: 'No cost log' };

    const lines = readFileSync(logPath, 'utf8')
      .split('\n')
      .filter(Boolean);

    for (const line of lines) {
      try {
        entries.push(normalizeCostEntry(JSON.parse(line)));
      } catch { /* skip */ }
    }
  } catch { /* skip */ }

  const analysis = analyzeCachePerformance(entries, provider);

  if (analysis.adjustBreakpoints && !dryRun) {
    // Persist adjustment
    strategy[provider] = {
      ...strategy[provider],
      lastReview: Date.now(),
      suggestion: analysis.suggestion,
      reason: analysis.reason,
      updatedAt: new Date().toISOString(),
    };
    writeStrategy(strategy);

    return { adjusted: true, suggestion: analysis.suggestion, reason: analysis.reason, strategy: strategy[provider] };
  }

  return { adjusted: false, reason: analysis.reason, strategy: strategy[provider] };
}

/**
 * Get current cache strategy for a provider.
 *
 * @param {string} provider
 * @returns {object|null}
 */
export function getCacheStrategy(provider) {
  const strategy = readStrategy();
  return strategy[provider] || null;
}

/**
 * Reset cache strategy for a provider (or all).
 *
 * @param {string} [provider] - if omitted, resets all
 */
export function resetCacheStrategy(provider) {
  if (provider) {
    const strategy = readStrategy();
    delete strategy[provider];
    writeStrategy(strategy);
  } else {
    writeStrategy({});
  }
}
