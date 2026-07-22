/**
 * lib/doctor/heartbeat.mjs — doctor daemon producer liveness from durable evidence.
 *
 * A live pid alone is not sufficient: the doctor records every watcher tick in
 * doctor-log.jsonl and persists lastEvidenceAt on doctor.json. Consumers pair
 * heartbeatFreshness with that audit trail so a zombie pid cannot masquerade as
 * healthy. Mirrors lib/oracle/heartbeat.mjs's shape for local-production-health.
 */

import { readState } from './index.mjs';
import { recent } from './audit.mjs';

export const DOCTOR_WATCHER_MIN_INTERVAL_MS = 60_000;
export const HEARTBEAT_STALE_MS = DOCTOR_WATCHER_MIN_INTERVAL_MS * 6;

export function formatAge(ageMs) {
  if (!Number.isFinite(ageMs)) return 'unknown';
  const hours = Math.floor(ageMs / (60 * 60 * 1000));
  if (hours < 1) return '<1h';
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function newestEvidenceMs(state, auditEntries, now) {
  const candidates = [];
  const stateAt = Number(state?.lastEvidenceAt ?? state?.updatedAt ?? state?.startedAt);
  if (Number.isFinite(stateAt) && stateAt > 0) candidates.push(stateAt);
  for (const entry of auditEntries) {
    if (Number.isFinite(entry?.ts) && entry.ts > 0) candidates.push(entry.ts);
  }
  if (!candidates.length) return Infinity;
  return now - Math.max(...candidates);
}

export function heartbeatFreshness({ state, auditEntries = [] }, now = Date.now()) {
  const evidenceAgeMs = newestEvidenceMs(state, auditEntries, now);
  return {
    evidenceAgeMs,
    stale: !Number.isFinite(evidenceAgeMs) || evidenceAgeMs > HEARTBEAT_STALE_MS,
    asOf: Number.isFinite(evidenceAgeMs) && evidenceAgeMs !== Infinity
      ? new Date(now - evidenceAgeMs).toISOString()
      : null,
  };
}

export function readDoctorHeartbeatStatus({ env = process.env, now = Date.now() } = {}) {
  if (env?.CONSTRUCT_DOCTOR === 'off' || env?.CONSTRUCT_DOCTOR === '0') {
    return { enabled: false, running: false, pidAlive: false, evidenceAgeMs: null, stale: false, asOf: null };
  }

  const state = readState();
  const running = !!state;
  if (!running) {
    return { enabled: true, running: false, pidAlive: false, evidenceAgeMs: null, stale: false, asOf: null, state: null };
  }

  const auditEntries = recent({ since: now - HEARTBEAT_STALE_MS, limit: 100 });
  const { evidenceAgeMs, stale, asOf } = heartbeatFreshness({ state, auditEntries }, now);
  return {
    enabled: true,
    running: true,
    pidAlive: true,
    evidenceAgeMs,
    stale,
    asOf,
    state,
    auditSampleCount: auditEntries.length,
  };
}
