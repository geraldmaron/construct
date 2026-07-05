/**
 * tests/doctor/oracle-liveness-watcher.test.mjs — LMCP: construct-a81q.
 *
 * Fixtures an old last-tick record (older than
 * lib/oracle/heartbeat.mjs's HEARTBEAT_STALE_MS) plus pending oracle work
 * under a tmp project, and asserts the oracle-liveness watcher escalates
 * exactly once per stale episode. A fresh tick, or a stale tick with no
 * pending work, must emit no escalation — the daemon idling out after a few
 * no-work ticks is not death.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { tempDir } from '../helpers.mjs';
import { writeLastTick } from '../../lib/oracle/index.mjs';
import { HEARTBEAT_STALE_MS } from '../../lib/oracle/heartbeat.mjs';

let watcher;
let audit;

test.before(async () => {
  process.env.CONSTRUCT_DOCTOR_ROOT = tempDir('construct-doctor-oracle-liveness-');
  audit = await import('../../lib/doctor/audit.mjs');
  watcher = await import('../../lib/doctor/watchers/oracle-liveness.mjs');
});

test.beforeEach(() => {
  watcher.__resetOracleLivenessWatcherState();
});

function withProjectDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-oracle-liveness-project-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function writePending(projectDir, records) {
  const dir = path.join(projectDir, '.cx', 'oracle');
  fs.mkdirSync(dir, { recursive: true });
  const now = new Date().toISOString();
  const lines = records.map((r) => JSON.stringify({
    id: r.id,
    status: 'pending',
    summary: r.summary || 'test pending item',
    kind: 'approve',
    queuedAt: now,
    firstSeenAt: now,
    lastSeenAt: now,
    dedupKey: `oracle:${r.id}`,
  }));
  fs.writeFileSync(path.join(dir, 'pending.jsonl'), lines.join('\n') + (lines.length ? '\n' : ''));
}

test('a stale last-tick plus pending oracle work escalates exactly once per episode', async () => {
  await withProjectDir(async (projectDir) => {
    const staleAt = new Date(Date.now() - HEARTBEAT_STALE_MS - 60_000).toISOString();
    writeLastTick({ at: staleAt, verdict: 'healthy', gaps: [] });
    writePending(projectDir, [{ id: 'p1' }]);

    const first = await watcher.tick({ projectDir });
    assert.equal(first.escalations.length, 1);
    assert.equal(first.escalations[0].eventType, 'oracle.producer_stalled');

    const second = await watcher.tick({ projectDir });
    assert.equal(second.escalations.length, 0, 'the same stale episode must not re-escalate');

    const recorded = audit.recent({ watcher: 'oracle-liveness', kind: 'sample' });
    assert.ok(recorded.some((r) => r.result === 'stalled'));
  });
});

test('a fresh last-tick with pending oracle work emits no escalation (idle-safe)', async () => {
  await withProjectDir(async (projectDir) => {
    writeLastTick({ at: new Date().toISOString(), verdict: 'healthy', gaps: [] });
    writePending(projectDir, [{ id: 'p2' }]);

    const result = await watcher.tick({ projectDir });
    assert.equal(result.escalations.length, 0);
  });
});

test('a stale last-tick with no pending oracle work emits no escalation (idle, not dead)', async () => {
  await withProjectDir(async (projectDir) => {
    const staleAt = new Date(Date.now() - HEARTBEAT_STALE_MS - 60_000).toISOString();
    writeLastTick({ at: staleAt, verdict: 'healthy', gaps: [] });
    writePending(projectDir, []);

    const result = await watcher.tick({ projectDir });
    assert.equal(result.escalations.length, 0);
  });
});

test('recovery after a stale+pending episode logs a recovery record', async () => {
  await withProjectDir(async (projectDir) => {
    const staleAt = new Date(Date.now() - HEARTBEAT_STALE_MS - 60_000).toISOString();
    writeLastTick({ at: staleAt, verdict: 'healthy', gaps: [] });
    writePending(projectDir, [{ id: 'p3' }]);
    await watcher.tick({ projectDir });

    writeLastTick({ at: new Date().toISOString(), verdict: 'healthy', gaps: [] });
    const result = await watcher.tick({ projectDir });
    assert.equal(result.escalations.length, 0);

    const recoveries = audit.recent({ watcher: 'oracle-liveness', kind: 'recovery' });
    assert.ok(recoveries.length > 0);
  });
});

test('CONSTRUCT_ORACLE=off disables the watcher entirely', async () => {
  await withProjectDir(async (projectDir) => {
    const staleAt = new Date(Date.now() - HEARTBEAT_STALE_MS - 60_000).toISOString();
    writeLastTick({ at: staleAt, verdict: 'healthy', gaps: [] });
    writePending(projectDir, [{ id: 'p4' }]);

    const result = await watcher.tick({ projectDir, env: { ...process.env, CONSTRUCT_ORACLE: 'off' } });
    assert.equal(result.escalations.length, 0);
  });
});
