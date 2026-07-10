/**
 * tests/intake-session-prelude-staleness.test.mjs — verdict age/staleness
 * rendering in the shared oracle prelude and dashboard dock.
 *
 * Pins buildOraclePrelude and readOracleDockState against fixture verdict
 * files under .cx/oracle/verdicts/<date>.json: a stale (~5 days old) verdict
 * must render a STALE marker and an "as of" date without dropping the gap
 * lines; a fresh (~2 hours old) verdict must render an age without STALE;
 * a missing/malformed `at` must resolve to unknown age, never fresh.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { buildOraclePrelude, readOracleDockState } from '../lib/intake/session-prelude.mjs';

let tmpRoot;
let verdictsDir;
let staleAt;

before(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-prelude-stale-'));
  verdictsDir = path.join(tmpRoot, '.construct', 'oracle', 'verdicts');
  fs.mkdirSync(verdictsDir, { recursive: true });
  staleAt = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
  writeVerdictFixture(staleAt.slice(0, 10), {
    at: staleAt,
    verdict: 'degraded',
    gaps: [{ id: 'contract-violations', severity: 'high', detail: '3 contract violation(s) in the last 24h' }],
  });
});

after(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function writeVerdictFixture(dateKey, latest) {
  const file = path.join(verdictsDir, `${dateKey}.json`);
  fs.writeFileSync(file, JSON.stringify({ date: dateKey, ticks: [latest], latest }, null, 2));
  return file;
}

describe('buildOraclePrelude staleness', () => {
  it('renders a STALE marker and the verdict date for a ~5 day old verdict', () => {
    const out = buildOraclePrelude({ cwd: tmpRoot });
    assert.match(out, /verdict: \*\*degraded\*\*/);
    assert.match(out, new RegExp(staleAt.slice(0, 10)));
    assert.match(out, /STALE/);
    assert.match(out, /contract violation\(s\) in the last 24h/);
  });

  it('renders an "as of" age without STALE for a ~2 hour old verdict', () => {
    const fresh = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-prelude-fresh-'));
    try {
      const dir = path.join(fresh, '.construct', 'oracle', 'verdicts');
      fs.mkdirSync(dir, { recursive: true });
      const at = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
      fs.writeFileSync(
        path.join(dir, `${at.slice(0, 10)}.json`),
        JSON.stringify({
          date: at.slice(0, 10),
          ticks: [{ at, verdict: 'degraded', gaps: [{ id: 'x', severity: 'high', detail: 'x' }] }],
          latest: { at, verdict: 'degraded', gaps: [{ id: 'x', severity: 'high', detail: 'x' }] },
        }, null, 2),
      );
      const out = buildOraclePrelude({ cwd: fresh });
      assert.match(out, /as of .+ ago\)/);
      assert.doesNotMatch(out, /STALE/);
    } finally {
      fs.rmSync(fresh, { recursive: true, force: true });
    }
  });

  it('does not render a missing/malformed `at` as fresh', () => {
    const bad = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-prelude-bad-at-'));
    try {
      const dir = path.join(bad, '.construct', 'oracle', 'verdicts');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, '2026-01-01.json'),
        JSON.stringify({
          date: '2026-01-01',
          ticks: [{ verdict: 'degraded', gaps: [{ id: 'x', severity: 'high', detail: 'x' }], at: 'not-a-date' }],
          latest: { verdict: 'degraded', gaps: [{ id: 'x', severity: 'high', detail: 'x' }], at: 'not-a-date' },
        }, null, 2),
      );
      const out = buildOraclePrelude({ cwd: bad });
      assert.match(out, /STALE/);
      assert.match(out, /as of unknown, unknown ago\)/);
      assert.doesNotMatch(out, /as of \d{4}-\d{2}-\d{2}/);

      const state = readOracleDockState({ cwd: bad });
      assert.equal(state.stale, true);
      assert.equal(state.asOf, null);
    } finally {
      fs.rmSync(bad, { recursive: true, force: true });
    }
  });
});

describe('readOracleDockState staleness parity', () => {
  it('returns stale: true and the correct asOf for the stale fixture', () => {
    const state = readOracleDockState({ cwd: tmpRoot });
    assert.equal(state.stale, true);
    assert.equal(state.asOf, staleAt);
  });

  it('returns stale: false for a fresh verdict', () => {
    const fresh = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-dock-fresh-'));
    try {
      const dir = path.join(fresh, '.construct', 'oracle', 'verdicts');
      fs.mkdirSync(dir, { recursive: true });
      const at = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
      fs.writeFileSync(
        path.join(dir, `${at.slice(0, 10)}.json`),
        JSON.stringify({
          date: at.slice(0, 10),
          ticks: [{ at, verdict: 'degraded', gaps: [] }],
          latest: { at, verdict: 'degraded', gaps: [] },
        }, null, 2),
      );
      const state = readOracleDockState({ cwd: fresh });
      assert.equal(state.stale, false);
      assert.equal(state.asOf, at);
    } finally {
      fs.rmSync(fresh, { recursive: true, force: true });
    }
  });
});
