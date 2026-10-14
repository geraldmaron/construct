/**
 * cli/holders.ts — inspect other processes holding a file open. An idle
 * SQLite connection is visible to the OS but not through SQLite's write lock.
 * Inspection failure must never be mistaken for an inspected empty result.
 */

import { spawnSync } from 'node:child_process';

export type HolderInspection =
  | { readonly inspected: true; readonly pids: readonly number[] }
  | { readonly inspected: false; readonly reason: string };

/** Other processes holding `path`; never this process. Probe is bounded. */
export function processesHolding(path: string): HolderInspection {
  const r = spawnSync('lsof', ['-t', '--', path], { encoding: 'utf8', timeout: 5000 });
  if (r.error) return { inspected: false, reason: r.error.message };
  if (r.signal || typeof r.stdout !== 'string' || typeof r.stderr !== 'string') {
    return { inspected: false, reason: 'holder inspection did not finish' };
  }
  // lsof exits 1 with no output when no matching files are open. Diagnostics,
  // unexpected exits, or malformed output do not establish an empty result.
  if (r.stderr.trim() || (r.status !== 0 && !(r.status === 1 && !r.stdout.trim()))) {
    return { inspected: false, reason: r.stderr.trim() || `lsof exited ${String(r.status)}` };
  }
  const lines = r.stdout.trim() ? r.stdout.trim().split('\n') : [];
  if (lines.some((line) => !/^\d+$/.test(line.trim()) || !Number.isSafeInteger(Number(line)) || Number(line) <= 0)) {
    return { inspected: false, reason: 'holder inspection returned invalid process ids' };
  }
  return { inspected: true, pids: [...new Set(lines.map(Number).filter((pid) => pid !== process.pid))] };
}
