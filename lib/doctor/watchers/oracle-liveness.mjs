/**
 * lib/doctor/watchers/oracle-liveness.mjs — oracle producer-liveness watcher.
 *
 * Applies the same idle-safe gate as lib/intake/session-prelude.mjs's
 * buildOraclePrelude()/readOracleDockState(): the oracle daemon idles itself
 * out after a few no-work ticks, so a stale last-tick record alone is not
 * death — only heartbeatFreshness().stale AND at least one pending oracle
 * item (lib/oracle/actions.mjs listPending(projectDir), filtered to
 * status==='pending') together mean the producer looks stalled rather than
 * quiet. Escalates once per stale episode (deduped by the last-tick record's
 * own `asOf`, so a producer stuck stale for hours doesn't spam every tick);
 * a fresh tick or an empty pending queue clears the episode. Tick: 60s.
 *
 * Needs the project directory (not just homeDir) to call listPending — the
 * doctor daemon's tick loop (lib/doctor/index.mjs) threads `projectDir`
 * through runWatcher()/tick(ctx) for this reason; every other watcher
 * ignores that extra argument.
 */

import { readHeartbeatStatus, formatAge } from '../../oracle/heartbeat.mjs';
import { listPending } from '../../oracle/actions.mjs';
import { record } from '../audit.mjs';
import { escalate } from '../escalate.mjs';

export const name = 'oracle-liveness';
export const intervalMs = 60 * 1000;

let lastEscalatedAsOf = null;

export async function tick({ projectDir = process.cwd(), env = process.env, homeDir } = {}) {
  const actions = [];
  const escalations = [];
  const notes = [];

  const heartbeat = readHeartbeatStatus({ homeDir, env });
  if (!heartbeat.enabled) {
    notes.push({ enabled: false });
    return { actions, escalations, notes };
  }

  let pending;
  try {
    pending = listPending(projectDir).filter((p) => p.status === 'pending');
  } catch (err) {
    notes.push({ error: `listPending failed: ${err.message}` });
    return { actions, escalations, notes };
  }

  notes.push({ stale: heartbeat.stale, ageMs: heartbeat.ageMs, asOf: heartbeat.asOf, pendingCount: pending.length });

  const stalled = heartbeat.stale && pending.length > 0;

  if (!stalled) {
    if (lastEscalatedAsOf) {
      record({
        kind: 'recovery',
        watcher: name,
        summary: `oracle producer recovered (fresh tick or pending queue cleared; was stalled as of ${lastEscalatedAsOf})`,
        context: { previousAsOf: lastEscalatedAsOf },
      });
    }
    lastEscalatedAsOf = null;
    return { actions, escalations, notes };
  }

  const episodeKey = heartbeat.asOf || 'unknown';
  if (lastEscalatedAsOf === episodeKey) return { actions, escalations, notes };

  const summary = `oracle-producer-stalled: no oracle tick in ${formatAge(heartbeat.ageMs)} while ${pending.length} pending oracle work item(s) wait (last tick as of ${heartbeat.asOf ?? 'unknown'})`;
  record({
    kind: 'sample',
    watcher: name,
    result: 'stalled',
    summary,
    context: { ageMs: heartbeat.ageMs, asOf: heartbeat.asOf, pendingCount: pending.length },
  });

  const result = await escalate({
    watcher: name,
    eventType: 'oracle.producer_stalled',
    summary,
    context: { ageMs: heartbeat.ageMs, asOf: heartbeat.asOf, pendingCount: pending.length },
  });
  lastEscalatedAsOf = episodeKey;
  escalations.push({ eventType: 'oracle.producer_stalled', result });

  return { actions, escalations, notes };
}

export function __resetOracleLivenessWatcherState() {
  lastEscalatedAsOf = null;
}
