/**
 * lib/oracle/heartbeat.mjs — oracle producer liveness from the last-tick record.
 *
 * The oracle daemon records last-tick.json when a tick completes and idles itself
 * out after a few no-work ticks, so a stale tick on its own is not death — it is a
 * dead-producer signal only when oracle work is actually waiting (pending approvals
 * or unaddressed gaps). Consumers therefore pair heartbeatFreshness with a pending
 * count; this module owns only the age check. It is deliberately distinct from
 * verdictFreshness in lib/intake/session-prelude.mjs, which ages the verdict's own
 * `at` (is the answer current) rather than the producer's tick `at` (is anything
 * still generating answers). formatAge is shared with the verdict path.
 */

import { readLastTick } from './index.mjs';

// Six missed 5-minute intervals clears the daemon's idle-shutdown window before a
// stale tick is treated as a stalled producer, so a briefly-quiet daemon is never
// mislabelled dead.
export const ORACLE_TICK_INTERVAL_MS = 5 * 60_000;
export const HEARTBEAT_STALE_MS = ORACLE_TICK_INTERVAL_MS * 6;

export function formatAge(ageMs) {
  if (!Number.isFinite(ageMs)) return 'unknown';
  const hours = Math.floor(ageMs / (60 * 60 * 1000));
  if (hours < 1) return '<1h';
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

// Missing or unparseable `at` resolves to Infinity — stale, never fresh — so an
// absent tick record reads as a stalled producer rather than a healthy one.

export function heartbeatFreshness(lastTick, now = Date.now()) {
  const at = lastTick?.at;
  const parsed = at ? Date.parse(at) : NaN;
  const ageMs = Number.isFinite(parsed) ? now - parsed : Infinity;
  return {
    ageMs,
    stale: !Number.isFinite(ageMs) || ageMs > HEARTBEAT_STALE_MS,
    asOf: Number.isFinite(parsed) ? new Date(parsed).toISOString() : null,
  };
}

// Honors the oracle off-switch so a deliberately disabled daemon is never flagged.

export function readHeartbeatStatus({ homeDir, env = process.env } = {}) {
  if (env?.CONSTRUCT_ORACLE === 'off' || env?.CONSTRUCT_ORACLE === '0') {
    return { enabled: false, lastTick: null, ageMs: null, stale: false, asOf: null };
  }
  const lastTick = readLastTick(homeDir);
  const { ageMs, stale, asOf } = heartbeatFreshness(lastTick);
  return { enabled: true, lastTick, ageMs, stale, asOf };
}
