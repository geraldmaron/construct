/**
 * tests/functional/oracle-heartbeat.functional.test.mjs — heartbeat file lifecycle.
 *
 * Tests heartbeatFreshness and readHeartbeatStatus with injected clock (no wall-clock
 * sleeps). Covers: heartbeat creation, tick updates, staleness detection when clock
 * advances past HEARTBEAT_STALE_MS, and oracle off-switch behavior.
 *
 * The oracle daemon records last-tick.json when a tick completes. The heartbeat is
 * stale when: (1) record is missing, (2) `at` field is unparseable, or (3) age
 * exceeds HEARTBEAT_STALE_MS (6 × 5-minute intervals = 30 minutes).
 */

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { writeLastTick, readLastTick } from '../../lib/oracle/index.mjs';
import {
  heartbeatFreshness,
  readHeartbeatStatus,
  HEARTBEAT_STALE_MS,
  ORACLE_TICK_INTERVAL_MS,
  formatAge,
} from '../../lib/oracle/heartbeat.mjs';

const tmpDirs = [];
after(() => {
  for (const dir of tmpDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
});

function freshHomeDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oracle-hb-home-'));
  tmpDirs.push(dir);
  return dir;
}

describe('heartbeatFreshness staleness determination', () => {
  it('marks a fresh heartbeat as not stale', () => {
    const now = Date.now();
    const recentTick = { at: new Date(now - 60_000).toISOString() };
    const freshness = heartbeatFreshness(recentTick, now);
    assert.equal(freshness.stale, false);
    assert.equal(freshness.ageMs, 60_000);
  });

  it('marks a stale heartbeat as stale', () => {
    const now = Date.now();
    const staleTick = { at: new Date(now - (HEARTBEAT_STALE_MS + 60_000)).toISOString() };
    const freshness = heartbeatFreshness(staleTick, now);
    assert.equal(freshness.stale, true);
    assert.equal(freshness.ageMs, HEARTBEAT_STALE_MS + 60_000);
  });

  it('marks heartbeat exactly at staleness boundary (HEARTBEAT_STALE_MS) as not stale', () => {
    const now = Date.now();
    const boundaryTick = { at: new Date(now - HEARTBEAT_STALE_MS).toISOString() };
    const freshness = heartbeatFreshness(boundaryTick, now);
    assert.equal(freshness.stale, false, 'exactly at boundary should be fresh');
    assert.equal(freshness.ageMs, HEARTBEAT_STALE_MS);
  });

  it('marks heartbeat just past staleness boundary (HEARTBEAT_STALE_MS + 1ms) as stale', () => {
    const now = Date.now();
    const pastBoundaryTick = { at: new Date(now - HEARTBEAT_STALE_MS - 1).toISOString() };
    const freshness = heartbeatFreshness(pastBoundaryTick, now);
    assert.equal(freshness.stale, true, 'just past boundary should be stale');
  });

  it('treats missing heartbeat as stale', () => {
    const now = Date.now();
    const freshness = heartbeatFreshness(null, now);
    assert.equal(freshness.stale, true);
    assert.equal(freshness.ageMs, Infinity);
  });

  it('treats unparseable timestamp as stale', () => {
    const now = Date.now();
    const badTick = { at: 'not-a-date' };
    const freshness = heartbeatFreshness(badTick, now);
    assert.equal(freshness.stale, true);
    assert.equal(freshness.ageMs, Infinity);
  });

  it('reports asOf when timestamp is valid', () => {
    const now = Date.now();
    const validTick = { at: new Date(now - 60_000).toISOString() };
    const freshness = heartbeatFreshness(validTick, now);
    assert.ok(freshness.asOf);
    assert.match(freshness.asOf, /Z$/);
  });

  it('reports null asOf when timestamp is invalid', () => {
    const now = Date.now();
    const badTick = { at: 'garbage' };
    const freshness = heartbeatFreshness(badTick, now);
    assert.equal(freshness.asOf, null);
  });
});

describe('heartbeat file lifecycle with injected clock', () => {
  it('creates and writes heartbeat record', () => {
    const homeDir = freshHomeDir();
    const now = Date.now();
    const tick = { at: new Date(now).toISOString(), verdict: 'healthy', gaps: [] };
    writeLastTick(tick, homeDir);

    const read = readLastTick(homeDir);
    assert.ok(read);
    assert.equal(read.verdict, 'healthy');
    assert.deepEqual(read.gaps, []);
  });

  it('updates heartbeat timestamp when tick is written', () => {
    const homeDir = freshHomeDir();
    const now1 = Date.now();
    const tick1 = { at: new Date(now1).toISOString(), verdict: 'healthy', gaps: [] };
    writeLastTick(tick1, homeDir);

    const now2 = now1 + 5 * 60_000;
    const tick2 = { at: new Date(now2).toISOString(), verdict: 'degraded', gaps: [{ id: 'test', severity: 'high', detail: 'x' }] };
    writeLastTick(tick2, homeDir);

    const read = readLastTick(homeDir);
    assert.equal(read.verdict, 'degraded');
    const age = now2 - Date.parse(read.at);
    assert.ok(age >= 0 && age < 1000, 'should have new timestamp');
  });

  it('simulates staleness via injected clock (no wall-clock sleep)', () => {
    const homeDir = freshHomeDir();
    const originalNow = Date.now();
    const tick = { at: new Date(originalNow).toISOString(), verdict: 'healthy', gaps: [] };
    writeLastTick(tick, homeDir);

    const read = readLastTick(homeDir);
    const freshness1 = heartbeatFreshness(read, originalNow);
    assert.equal(freshness1.stale, false, 'fresh at original time');

    const laterNow = originalNow + HEARTBEAT_STALE_MS + 1;
    const freshness2 = heartbeatFreshness(read, laterNow);
    assert.equal(freshness2.stale, true, 'stale at later injected time');
  });

  it('detects staleness boundary exactly (both sides) via injected clock', () => {
    const homeDir = freshHomeDir();
    const tickTime = Date.now();
    const tick = { at: new Date(tickTime).toISOString(), verdict: 'healthy', gaps: [] };
    writeLastTick(tick, homeDir);

    const read = readLastTick(homeDir);

    const atBoundary = tickTime + HEARTBEAT_STALE_MS;
    const freshness1 = heartbeatFreshness(read, atBoundary);
    assert.equal(freshness1.stale, false, 'exactly at boundary is fresh');

    const pastBoundary = tickTime + HEARTBEAT_STALE_MS + 1;
    const freshness2 = heartbeatFreshness(read, pastBoundary);
    assert.equal(freshness2.stale, true, 'past boundary is stale');
  });

  it('multiple clock advances without writes remain stale after threshold', () => {
    const homeDir = freshHomeDir();
    const originalTime = Date.now();
    const tick = { at: new Date(originalTime).toISOString(), verdict: 'healthy', gaps: [] };
    writeLastTick(tick, homeDir);

    const read = readLastTick(homeDir);

    const time1 = originalTime + (ORACLE_TICK_INTERVAL_MS * 3);
    const freshness1 = heartbeatFreshness(read, time1);
    assert.equal(freshness1.stale, false, 'after 3 intervals fresh');

    const time2 = originalTime + (ORACLE_TICK_INTERVAL_MS * 7);
    const freshness2 = heartbeatFreshness(read, time2);
    assert.equal(freshness2.stale, true, 'after 7 intervals (> 6) stale');
  });
});

describe('readHeartbeatStatus oracle control', () => {
  it('reports enabled: true when oracle is on', () => {
    const homeDir = freshHomeDir();
    const now = Date.now();
    writeLastTick({ at: new Date(now).toISOString(), verdict: 'healthy', gaps: [] }, homeDir);
    const env = {};
    const status = readHeartbeatStatus({ homeDir, env });
    assert.equal(status.enabled, true);
    assert.equal(status.stale, false);
  });

  it('reports enabled: false and stale: false when CONSTRUCT_ORACLE=off', () => {
    const homeDir = freshHomeDir();
    const env = { CONSTRUCT_ORACLE: 'off' };
    const status = readHeartbeatStatus({ homeDir, env });
    assert.equal(status.enabled, false);
    assert.equal(status.stale, false, 'disabled oracle never flags stale');
    assert.equal(status.lastTick, null);
    assert.equal(status.ageMs, null);
  });

  it('reports enabled: false when CONSTRUCT_ORACLE=0', () => {
    const homeDir = freshHomeDir();
    const env = { CONSTRUCT_ORACLE: '0' };
    const status = readHeartbeatStatus({ homeDir, env });
    assert.equal(status.enabled, false);
    assert.equal(status.stale, false);
  });

  it('reads and evaluates heartbeat when enabled', () => {
    const homeDir = freshHomeDir();
    const now = Date.now();
    writeLastTick({ at: new Date(now - 60_000).toISOString(), verdict: 'degraded', gaps: [] }, homeDir);
    const env = {};
    const status = readHeartbeatStatus({ homeDir, env });
    assert.equal(status.enabled, true);
    assert.ok(status.lastTick);
    assert.equal(status.lastTick.verdict, 'degraded');
    assert.ok(Number.isFinite(status.ageMs));
  });

  it('reports null tick when no record exists', () => {
    const homeDir = freshHomeDir();
    const env = {};
    const status = readHeartbeatStatus({ homeDir, env });
    assert.equal(status.enabled, true);
    assert.equal(status.lastTick, null);
    assert.equal(status.stale, true, 'missing tick is treated as stale');
  });
});

describe('formatAge human-readable age display', () => {
  it('formats less than 1 hour as <1h', () => {
    assert.equal(formatAge(30 * 60_000), '<1h');
    assert.equal(formatAge(1000), '<1h');
  });

  it('formats 1-24 hours as Xh', () => {
    assert.equal(formatAge(1 * 60 * 60_000), '1h');
    assert.equal(formatAge(12 * 60 * 60_000), '12h');
    assert.equal(formatAge(23 * 60 * 60_000), '23h');
  });

  it('formats 24+ hours as Xd', () => {
    assert.equal(formatAge(24 * 60 * 60_000), '1d');
    assert.equal(formatAge(48 * 60 * 60_000), '2d');
    assert.equal(formatAge(72 * 60 * 60_000), '3d');
  });

  it('formats non-finite age as unknown', () => {
    assert.equal(formatAge(Infinity), 'unknown');
    assert.equal(formatAge(NaN), 'unknown');
    assert.equal(formatAge(undefined), 'unknown');
  });
});
