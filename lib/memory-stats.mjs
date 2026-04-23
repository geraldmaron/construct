/**
 * lib/memory-stats.mjs — memory layer usage statistics and JSONL snapshot appender.
 *
 * Reads .cx/memory-stats.jsonl (one JSON line per session) and computes aggregates:
 * queries/session, avg observations injected, p95 retrieval latency, hit rate.
 * appendSessionStats() is called at session end to record the current session.
 *
 * Stats are approximated from session-start injection counts and search call counts
 * recorded by the observation store instrumentation. CONSTRUCT_MEMORY=off skips injection
 * but still records a zero-hit entry so A/B comparisons are possible.
 */

import fs from 'node:fs';
import path from 'node:path';

const STATS_FILE = '.cx/memory-stats.jsonl';

function statsPath(rootDir) {
  return path.join(rootDir, STATS_FILE);
}

function ensureDir(p) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
}

function readLines(rootDir) {
  const p = statsPath(rootDir);
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => { try { return JSON.parse(line); } catch { return null; } })
    .filter(Boolean);
}

/**
 * Append one session's memory stats to the JSONL log.
 * Fields: sessionId, project, at, queriesIssued, observationsInjected,
 *         retrievalMs (p50 estimate), memoryEnabled.
 */
export function appendSessionStats(rootDir, {
  sessionId = null,
  project = null,
  queriesIssued = 0,
  observationsInjected = 0,
  retrievalMs = null,
  memoryEnabled = true,
} = {}) {
  const entry = {
    sessionId,
    project,
    at: new Date().toISOString(),
    queriesIssued,
    observationsInjected,
    retrievalMs,
    memoryEnabled,
  };
  const p = statsPath(rootDir);
  ensureDir(p);
  fs.appendFileSync(p, JSON.stringify(entry) + '\n');
  return entry;
}

/**
 * Compute aggregate stats from the JSONL log.
 * Returns { sessions, avgQueriesPerSession, avgInjectedPerSession,
 *           p95RetrievalMs, hitRate, memoryEnabledPct }.
 */
export function computeStats(rootDir, { project = null, lastN = 50 } = {}) {
  let lines = readLines(rootDir);
  if (project) lines = lines.filter((l) => l.project === project);
  lines = lines.slice(-lastN);

  if (!lines.length) {
    return { sessions: 0, avgQueriesPerSession: 0, avgInjectedPerSession: 0, p95RetrievalMs: null, hitRate: 0, memoryEnabledPct: 100 };
  }

  const sessions = lines.length;
  const totalQueries = lines.reduce((s, l) => s + (l.queriesIssued || 0), 0);
  const totalInjected = lines.reduce((s, l) => s + (l.observationsInjected || 0), 0);
  const enabledCount = lines.filter((l) => l.memoryEnabled !== false).length;

  const latencies = lines
    .map((l) => l.retrievalMs)
    .filter((v) => typeof v === 'number' && v > 0)
    .sort((a, b) => a - b);

  const p95RetrievalMs = latencies.length
    ? latencies[Math.floor(latencies.length * 0.95)]
    : null;

  const sessionsWithHits = lines.filter((l) => (l.observationsInjected || 0) > 0).length;
  const hitRate = sessions > 0 ? Math.round((sessionsWithHits / sessions) * 100) : 0;

  return {
    sessions,
    avgQueriesPerSession: Math.round((totalQueries / sessions) * 10) / 10,
    avgInjectedPerSession: Math.round((totalInjected / sessions) * 10) / 10,
    p95RetrievalMs,
    hitRate,
    memoryEnabledPct: Math.round((enabledCount / sessions) * 100),
  };
}

/**
 * Format stats for terminal display.
 */
export function formatStats(stats) {
  if (stats.sessions === 0) {
    return '  No memory stats recorded yet. Run a few sessions and try again.\n';
  }
  const lines = [
    `  Sessions tracked:      ${stats.sessions}`,
    `  Avg queries/session:   ${stats.avgQueriesPerSession}`,
    `  Avg injected/session:  ${stats.avgInjectedPerSession}`,
    `  Hit rate:              ${stats.hitRate}%`,
    `  p95 retrieval latency: ${stats.p95RetrievalMs != null ? `${stats.p95RetrievalMs}ms` : 'n/a'}`,
    `  Memory enabled:        ${stats.memoryEnabledPct}% of sessions`,
  ];
  return lines.join('\n') + '\n';
}
