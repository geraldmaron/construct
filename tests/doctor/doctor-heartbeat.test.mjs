/**
 * tests/doctor/doctor-heartbeat.test.mjs — independent doctor-daemon liveness evidence.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HEARTBEAT_STALE_MS,
  heartbeatFreshness,
  readDoctorHeartbeatStatus,
} from '../../lib/doctor/heartbeat.mjs';

test('heartbeatFreshness treats missing evidence as stale', () => {
  const now = Date.now();
  const result = heartbeatFreshness({ state: {}, auditEntries: [] }, now);
  assert.equal(result.stale, true);
});

test('heartbeatFreshness is fresh when lastEvidenceAt is recent', () => {
  const now = Date.now();
  const result = heartbeatFreshness(
    { state: { lastEvidenceAt: now - 30_000 }, auditEntries: [{ ts: now - 30_000 }] },
    now,
  );
  assert.equal(result.stale, false);
});

test('readDoctorHeartbeatStatus skips when doctor is not running', () => {
  const status = readDoctorHeartbeatStatus({ env: { ...process.env, CONSTRUCT_DOCTOR: 'off' } });
  assert.equal(status.enabled, false);
  assert.equal(status.stale, false);
});

test('HEARTBEAT_STALE_MS covers six minimum watcher intervals', () => {
  assert.equal(HEARTBEAT_STALE_MS, 60_000 * 6);
});
