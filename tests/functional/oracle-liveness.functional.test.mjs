/**
 * oracle-liveness.functional.test.mjs — surface a stalled oracle producer.
 *
 * The daemon idles itself out when there is no work, so a stale last-tick is only
 * a dead-producer signal when approvals are actually waiting. buildOraclePrelude
 * and readOracleDockState flag "producer stalled" only when the tick is stale AND
 * pending work exists — never for a legitimately idle daemon — and the signal is
 * distinct from the verdict-age STALE marker. Unit-checks heartbeatFreshness too.
 * Seeds a tmp homeDir (last-tick.json) and tmp project (.cx/oracle) so nothing real
 * is read.
 */

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { buildOraclePrelude, readOracleDockState } from '../../lib/intake/session-prelude.mjs';
import { writeLastTick } from '../../lib/oracle/index.mjs';
import { heartbeatFreshness, readHeartbeatStatus, HEARTBEAT_STALE_MS } from '../../lib/oracle/heartbeat.mjs';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const dirs = [];
after(() => {
  for (const d of dirs) {
    try { rmTmpDir(d); } catch { /* best effort */ }
  }
});

function isoAgo(ms) {
  return new Date(Date.now() - ms).toISOString();
}

function makeScenario({ tickAgoMs, verdictAgoMs, pendingCount }) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-oracle-live-cwd-'));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-oracle-live-home-'));
  dirs.push(cwd, home);

  const oracleDir = path.join(cwd, '.construct', 'oracle');
  fs.mkdirSync(path.join(oracleDir, 'verdicts'), { recursive: true });

  if (verdictAgoMs != null) {
    const at = isoAgo(verdictAgoMs);
    const latest = { at, verdict: 'degraded', gaps: [{ id: 'x', severity: 'high', detail: 'x' }] };
    fs.writeFileSync(path.join(oracleDir, 'verdicts', `${at.slice(0, 10)}.json`), JSON.stringify({ date: at.slice(0, 10), ticks: [latest], latest }, null, 2));
  }
  if (pendingCount > 0) {
    const lines = Array.from({ length: pendingCount }, (_, i) => JSON.stringify({ id: `p${i}`, status: 'pending', detail: 'awaiting review' }));
    fs.writeFileSync(path.join(oracleDir, 'pending.jsonl'), `${lines.join('\n')}\n`);
  }
  if (tickAgoMs != null) {
    writeLastTick({ at: isoAgo(tickAgoMs), verdict: 'degraded', gaps: [] }, home);
  }
  return { cwd, home };
}

const OLD = HEARTBEAT_STALE_MS + 60 * 60 * 1000;
const FRESH = 60 * 1000;

describe('heartbeatFreshness', () => {
  it('marks an old tick stale and a fresh tick not stale', () => {
    assert.equal(heartbeatFreshness({ at: isoAgo(OLD) }).stale, true);
    assert.equal(heartbeatFreshness({ at: isoAgo(FRESH) }).stale, false);
  });
  it('treats a missing/unparseable at as stale (Infinity age), never fresh', () => {
    assert.equal(heartbeatFreshness(null).stale, true);
    assert.equal(heartbeatFreshness({ at: 'not-a-date' }).ageMs, Infinity);
  });
  it('reports disabled when CONSTRUCT_ORACLE=off', () => {
    const s = readHeartbeatStatus({ homeDir: os.tmpdir(), env: { CONSTRUCT_ORACLE: 'off' } });
    assert.equal(s.enabled, false);
    assert.equal(s.stale, false);
  });
});

describe('buildOraclePrelude producer liveness', () => {
  it('flags a stalled producer when the tick is stale AND approvals wait', () => {
    const { cwd, home } = makeScenario({ tickAgoMs: OLD, verdictAgoMs: 3 * 60 * 60 * 1000, pendingCount: 2 });
    const out = buildOraclePrelude({ cwd, homeDir: home });
    assert.match(out, /oracle-producer-stalled/);
    assert.match(out, /2 approval\(s\) wait/);
  });

  it('does NOT flag a stale tick when no approvals wait (idle, not dead)', () => {
    const { cwd, home } = makeScenario({ tickAgoMs: OLD, verdictAgoMs: 3 * 60 * 60 * 1000, pendingCount: 0 });
    const out = buildOraclePrelude({ cwd, homeDir: home });
    assert.doesNotMatch(out, /oracle-producer-stalled/);
  });

  it('does NOT flag a fresh producer even with approvals waiting', () => {
    const { cwd, home } = makeScenario({ tickAgoMs: FRESH, verdictAgoMs: 3 * 60 * 60 * 1000, pendingCount: 2 });
    const out = buildOraclePrelude({ cwd, homeDir: home });
    assert.doesNotMatch(out, /oracle-producer-stalled/);
  });

  it('flags a missing tick record as stalled when approvals wait', () => {
    const { cwd, home } = makeScenario({ tickAgoMs: null, verdictAgoMs: 3 * 60 * 60 * 1000, pendingCount: 1 });
    const out = buildOraclePrelude({ cwd, homeDir: home });
    assert.match(out, /oracle-producer-stalled/);
  });

  it('is distinct from verdict staleness: a fresh verdict with a stale producer shows stalled but not STALE', () => {
    const { cwd, home } = makeScenario({ tickAgoMs: OLD, verdictAgoMs: 10 * 60 * 1000, pendingCount: 1 });
    const out = buildOraclePrelude({ cwd, homeDir: home });
    assert.match(out, /oracle-producer-stalled/);
    assert.doesNotMatch(out, /STALE/);
  });
});

describe('readOracleDockState producer liveness', () => {
  it('sets producerStalled true only with a stale tick and pending work', () => {
    const stalled = makeScenario({ tickAgoMs: OLD, verdictAgoMs: 3 * 60 * 60 * 1000, pendingCount: 2 });
    assert.equal(readOracleDockState({ cwd: stalled.cwd, homeDir: stalled.home }).producerStalled, true);

    const idle = makeScenario({ tickAgoMs: OLD, verdictAgoMs: 3 * 60 * 60 * 1000, pendingCount: 0 });
    assert.equal(readOracleDockState({ cwd: idle.cwd, homeDir: idle.home }).producerStalled, false);
  });
});
