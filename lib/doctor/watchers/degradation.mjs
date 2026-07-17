/**
 * lib/doctor/watchers/degradation.mjs — surfaces daemon capability declines.
 *
 * Ticks every 5 minutes. Reads .construct/degradation.jsonl
 * (lib/embed/degradation.mjs) and escalates each entry once — a directive
 * referencing an unknown specialist, an unavailable provider, or any other
 * daemon job that declined work rather than silently no-oping.
 */

import { listDegradations } from '../../embed/degradation.mjs';
import { record } from '../audit.mjs';
import { escalate } from '../escalate.mjs';

export const name = 'degradation';
export const intervalMs = 5 * 60 * 1000;

const escalatedKeys = new Set();

function projectRoot() {
  return process.env.CONSTRUCT_PROJECT_ROOT || process.cwd();
}

function entryKey(entry) {
  return `${entry.job}:${entry.reason}:${entry.at}`;
}

export async function tick() {
  const escalations = [];
  const root = projectRoot();

  const entries = listDegradations(root);
  const notes = [{ degradationCount: entries.length }];

  for (const entry of entries) {
    const key = entryKey(entry);
    if (escalatedKeys.has(key)) continue;

    const summary = `${entry.job} declined work: ${entry.reason}${entry.detail ? ` (${entry.detail})` : ''}`;
    record({
      kind: 'sample',
      watcher: name,
      target: key,
      result: 'degraded',
      summary,
      context: { job: entry.job, reason: entry.reason, detail: entry.detail },
    });
    const result = await escalate({
      watcher: name,
      eventType: 'daemon.capability_declined',
      summary,
      context: { job: entry.job, reason: entry.reason },
    });
    escalatedKeys.add(key);
    escalations.push({ eventType: 'daemon.capability_declined', key, result });
  }

  return { actions: [], escalations, notes };
}

export function __resetDegradationWatcherState() {
  escalatedKeys.clear();
}
