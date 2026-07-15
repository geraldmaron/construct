/**
 * tests/directives/due-tracker.test.mjs — per-directive last-run bookkeeping
 * (lib/directives/due-tracker.mjs).
 */
import { describe, it, beforeEach, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { readDirectiveState, writeDirectiveState, isDirectiveDue } from '../../lib/directives/due-tracker.mjs';

// readDirectiveState/writeDirectiveState resolve through the machine-scoped
// state root (ADR-0066, lib/state-root.mjs) — CX_HOME_OVERRIDE keeps that
// off the real developer machine's $HOME for the whole file.

const homeOverride = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-due-tracker-home-'));
const prevHomeOverride = process.env.CX_HOME_OVERRIDE;
process.env.CX_HOME_OVERRIDE = homeOverride;
after(() => {
  try { fs.rmSync(homeOverride, { recursive: true, force: true }); } catch {}
  if (prevHomeOverride === undefined) delete process.env.CX_HOME_OVERRIDE;
  else process.env.CX_HOME_OVERRIDE = prevHomeOverride;
});

let projectRoot;

beforeEach(() => {
  projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-due-tracker-'));
});

afterEach(() => {
  fs.rmSync(projectRoot, { recursive: true, force: true });
});

describe('readDirectiveState / writeDirectiveState', () => {
  it('returns lastRunAt=null for a directive that has never run', () => {
    assert.deepEqual(readDirectiveState(projectRoot, 'never-run'), { lastRunAt: null });
  });

  it('round-trips a written lastRunAt', () => {
    writeDirectiveState(projectRoot, 'jira-weekly', { lastRunAt: '2026-07-01T00:00:00.000Z' });
    assert.deepEqual(readDirectiveState(projectRoot, 'jira-weekly'), { lastRunAt: '2026-07-01T00:00:00.000Z' });
  });
});

describe('isDirectiveDue', () => {
  const interval = { trigger: { kind: 'interval', intervalMinutes: 60 } };

  it('is due when it has never run', () => {
    assert.equal(isDirectiveDue(interval, { lastRunAt: null }), true);
  });

  it('is not due before the interval elapses', () => {
    const now = Date.parse('2026-07-01T01:00:00.000Z');
    const state = { lastRunAt: '2026-07-01T00:30:00.000Z' };
    assert.equal(isDirectiveDue(interval, state, now), false);
  });

  it('is due once the interval has elapsed', () => {
    const now = Date.parse('2026-07-01T01:00:01.000Z');
    const state = { lastRunAt: '2026-07-01T00:00:00.000Z' };
    assert.equal(isDirectiveDue(interval, state, now), true);
  });

  it('an on-demand trigger is never due on a tick', () => {
    const onDemand = { trigger: { kind: 'on-demand' } };
    assert.equal(isDirectiveDue(onDemand, { lastRunAt: null }), false);
  });
});
