/**
 * lib/doctor/watchers/orchestration-runs.mjs — surfaces error/degraded
 * orchestration runs to the doctor audit log.
 *
 * lib/orchestration/runtime.mjs persists a terminal 'error' status (thrown
 * mid-execution) or a 'degraded'/'completed-with-failures' status (a run
 * that finished but not cleanly) to the run store via getRun/getRuns. Each
 * tick here scans the most recent runs for the project the daemon is
 * running in and records a finding when any carry an error or
 * degraded/failed terminal status, so `construct doctor logs
 * --watcher=orchestration-runs` (and the audit trail generally) reflects
 * runs that did not complete cleanly, not just clean completions.
 *
 * Read-only and advisory: this watcher never mutates a run or retries it.
 */

import { record } from '../audit.mjs';

const ATTENTION_STATUSES = new Set(['error', 'degraded', 'completed-with-failures']);

export const name = 'orchestration-runs';
export const intervalMs = 10 * 60 * 1000;

function projectRoot() {
  return process.env.CONSTRUCT_PROJECT_ROOT || process.cwd();
}

function needsAttention(run) {
  return ATTENTION_STATUSES.has(run.status) || run.degraded === true;
}

export async function tick() {
  const actions = [];
  const escalations = [];
  const root = projectRoot();

  const { getRuns } = await import('../../orchestration/runtime.mjs');
  const runs = await getRuns(root, { env: process.env, limit: 50 });
  const affected = runs.filter(needsAttention);

  if (affected.length === 0) {
    return { actions, escalations, notes: [{ scanned: runs.length, affected: 0 }] };
  }

  // getRuns/listRuns sorts newest-first (createdAt desc) across every store
  // backend, so the first affected entry is the newest.
  const newest = affected[0];
  record({
    kind: 'finding',
    watcher: name,
    result: 'attention',
    summary: `${affected.length} of ${runs.length} recent run(s) carry an error/degraded status; newest is ${newest.runId} (${newest.status})`,
    context: {
      scanned: runs.length,
      affectedCount: affected.length,
      newestRunId: newest.runId,
      newestStatus: newest.status,
      affectedRunIds: affected.map((r) => r.runId).slice(0, 10),
    },
  });

  return { actions, escalations, notes: [{ scanned: runs.length, affected: affected.length }] };
}
