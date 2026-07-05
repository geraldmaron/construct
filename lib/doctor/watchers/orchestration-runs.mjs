/**
 * lib/doctor/watchers/orchestration-runs.mjs — surfaces error/degraded and
 * stale awaiting-host orchestration runs to the doctor audit log.
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
 * A host-backend run standing at 'awaiting-host' is not itself an error — it
 * is the designed non-terminal state while a host executes the materialized
 * prompts — but a run whose `updatedAt` has not moved in
 * CONSTRUCT_AWAITING_HOST_STALE_MS (default 30 minutes) means the host that
 * requested it likely disconnected before submitting every task result.
 * That is flagged as a separate advisory finding, never a hard failure, so an
 * abandoned run stays visible rather than silently invisible.
 *
 * Read-only and advisory: this watcher never mutates a run or retries it.
 */

import { record } from '../audit.mjs';
import { resolveNonNegativeSetting } from '../../env-config.mjs';

const ATTENTION_STATUSES = new Set(['error', 'degraded', 'completed-with-failures']);

// 30 minutes: long enough that a host actively working through a multi-task
// run (each submission round-trips the calling agent's own reasoning) is never
// falsely flagged, short enough that a genuinely disconnected session surfaces
// within one doctor watch cycle or two.

const DEFAULT_AWAITING_HOST_STALE_MS = 30 * 60 * 1000;

export const name = 'orchestration-runs';
export const intervalMs = 10 * 60 * 1000;

function projectRoot() {
  return process.env.CONSTRUCT_PROJECT_ROOT || process.cwd();
}

function needsAttention(run) {
  return ATTENTION_STATUSES.has(run.status) || run.degraded === true;
}

function isStaleAwaitingHost(run, staleMs, now) {
  if (run.status !== 'awaiting-host') return false;
  const touchedAt = Date.parse(run.updatedAt || run.createdAt || '');
  if (!Number.isFinite(touchedAt)) return false;
  return now - touchedAt >= staleMs;
}

export async function tick() {
  const actions = [];
  const escalations = [];
  const root = projectRoot();
  const now = Date.now();
  const staleMs = resolveNonNegativeSetting(process.env, 'CONSTRUCT_AWAITING_HOST_STALE_MS', DEFAULT_AWAITING_HOST_STALE_MS);

  const { getRuns } = await import('../../orchestration/runtime.mjs');
  const runs = await getRuns(root, { env: process.env, limit: 50 });
  const affected = runs.filter(needsAttention);
  const staleAwaitingHost = runs.filter((r) => isStaleAwaitingHost(r, staleMs, now));

  if (affected.length > 0) {
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
  }

  if (staleAwaitingHost.length > 0) {
    const newest = staleAwaitingHost[0];
    record({
      kind: 'finding',
      watcher: name,
      result: 'attention',
      summary: `${staleAwaitingHost.length} of ${runs.length} recent run(s) have stood 'awaiting-host' for over ${Math.round(staleMs / 60000)} minute(s) with no submitted result; newest is ${newest.runId}`,
      context: {
        scanned: runs.length,
        staleAwaitingHostCount: staleAwaitingHost.length,
        staleThresholdMs: staleMs,
        newestRunId: newest.runId,
        staleRunIds: staleAwaitingHost.map((r) => r.runId).slice(0, 10),
      },
    });
  }

  if (affected.length === 0 && staleAwaitingHost.length === 0) {
    return { actions, escalations, notes: [{ scanned: runs.length, affected: 0, staleAwaitingHost: 0 }] };
  }

  return { actions, escalations, notes: [{ scanned: runs.length, affected: affected.length, staleAwaitingHost: staleAwaitingHost.length }] };
}
