/**
 * lib/telemetry/backends/local.mjs — Local JSONL trace backend.
 *
 * Reads trace events from ~/.cx/traces/*.jsonl files.
 * No remote calls. Always available. Used when CONSTRUCT_TRACE_BACKEND=local.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export const name = 'local';

const TRACES_DIR = join(homedir(), '.cx', 'traces');

export async function isAvailable() {
  return true;
}

/**
 * Fetch traces from local JSONL files within a time window.
 *
 * @param {string} teamId - The overlay/team ID to filter by.
 * @param {number} windowMs - Lookback window in milliseconds.
 * @returns {Promise<object[]>}
 */
export async function listTraces(teamId, windowMs) {
  if (!existsSync(TRACES_DIR)) return [];

  const since = Date.now() - windowMs;
  const files = readdirSync(TRACES_DIR)
    .filter((f) => f.endsWith('.jsonl'))
    .sort()
    .reverse()
    .slice(0, 7); // last 7 days of files

  const traces = [];
  for (const file of files) {
    const lines = readFileSync(join(TRACES_DIR, file), 'utf8')
      .split('\n')
      .filter(Boolean);
    for (const line of lines) {
      try {
        const event = JSON.parse(line);
        if (new Date(event.createdAt).getTime() < since) continue;
        if (teamId && event.project && event.project !== teamId) continue;
        traces.push({
          id: event.traceId ?? event.spanId,
          teamId: event.project ?? teamId,
          agentName: event.role ?? event.eventType ?? 'unknown',
          status: 'local',
          latencyMs: null,
          qualityScore: null,
          createdAt: event.createdAt,
          blockers: [],
          handoffs: 0,
        });
      } catch { /* skip malformed lines */ }
    }
  }
  return traces;
}
