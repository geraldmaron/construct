/**
 * oracle-daemon-retired.functional.test.mjs — a dead oracle daemon is the designed state.
 *
 * The oracle background daemon is retired (construct-b0nny.29): no code path
 * spawns it and `construct oracle start` prints a removal notice. A stale
 * last-tick with pending approvals is therefore normal operation, never a
 * "producer stalled" failure — session-start surfaces must not nag the user
 * to start a daemon that must never run. Pins buildOraclePrelude and
 * readOracleDockState against the nag's exact trigger scenario (stale tick
 * AND pending approvals) and asserts no stalled-producer framing appears
 * while the verdict/pending surfaces still render. Seeds a tmp homeDir
 * (last-tick.json) and tmp project (.construct/oracle) so nothing real is read.
 */

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { buildOraclePrelude, readOracleDockState, formatOracleDockDetail } from '../../lib/intake/session-prelude.mjs';
import { writeLastTick } from '../../lib/oracle/index.mjs';
import { HEARTBEAT_STALE_MS } from '../../lib/oracle/heartbeat.mjs';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const dirs = [];
after(() => {
  for (const d of dirs) {
    try { rmTmpDir(d); } catch {}
  }
});

function isoAgo(ms) {
  return new Date(Date.now() - ms).toISOString();
}

function makeScenario({ tickAgoMs, verdictAgoMs, pendingCount }) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-oracle-retired-cwd-'));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-oracle-retired-home-'));
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

describe('buildOraclePrelude with a retired daemon', () => {
  it('never emits a stalled-producer nag, even with a stale tick and pending approvals', () => {
    const { cwd, home } = makeScenario({ tickAgoMs: OLD, verdictAgoMs: 3 * 60 * 60 * 1000, pendingCount: 2 });
    const out = buildOraclePrelude({ cwd, homeDir: home });
    assert.doesNotMatch(out, /oracle-producer-stalled/);
    assert.doesNotMatch(out, /oracle start/);
    assert.doesNotMatch(out, /stalled/i);
  });

  it('still surfaces the verdict and the pending-approvals queue', () => {
    const { cwd, home } = makeScenario({ tickAgoMs: OLD, verdictAgoMs: 3 * 60 * 60 * 1000, pendingCount: 2 });
    const out = buildOraclePrelude({ cwd, homeDir: home });
    assert.match(out, /Oracle overseer · verdict: \*\*degraded\*\*/);
    assert.match(out, /Pending approvals \(2\)/);
  });
});

describe('readOracleDockState with a retired daemon', () => {
  it('exposes no producer-stalled surface for a stale tick with pending work', () => {
    const { cwd, home } = makeScenario({ tickAgoMs: OLD, verdictAgoMs: 3 * 60 * 60 * 1000, pendingCount: 2 });
    const state = readOracleDockState({ cwd, homeDir: home });
    assert.equal('producerStalled' in state, false);
    assert.doesNotMatch(state.summary, /PRODUCER STALLED/);
    assert.equal(state.visible, true);
    assert.equal(state.pendingCount, 2);
  });

  it('formatOracleDockDetail renders no daemon-down framing', () => {
    const { cwd, home } = makeScenario({ tickAgoMs: OLD, verdictAgoMs: 3 * 60 * 60 * 1000, pendingCount: 1 });
    const detail = formatOracleDockDetail(readOracleDockState({ cwd, homeDir: home }));
    assert.doesNotMatch(detail, /PRODUCER STALLED/);
    assert.doesNotMatch(detail, /daemon/i);
    assert.match(detail, /Pending: construct oracle pending/);
  });
});
