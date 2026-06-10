/**
 * hook-calls.test.mjs — per-hook fire/block/error telemetry (bead construct-dcnb).
 *
 * Pins the value signals the proliferation audit found missing: a hook's fire
 * count, how often it blocked (exit 2) vs errored (other non-zero), and which
 * registered hooks never fire (idle). Uses an explicit logPath tmpdir so no real
 * ~/.cx log is touched.
 */
import test from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { logHookCall, summarizeHookCalls, findIdleHooks, outcomeFromExit } from '../../lib/telemetry/hook-calls.mjs';

function tmpLog() {
  const dir = mkdtempSync(join(tmpdir(), 'cx-hookcalls-'));
  return { path: join(dir, 'hook-calls.jsonl'), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('outcomeFromExit maps the Claude Code hook convention', () => {
  assert.equal(outcomeFromExit(0), 'ok');
  assert.equal(outcomeFromExit(null), 'ok');
  assert.equal(outcomeFromExit(2), 'blocked');
  assert.equal(outcomeFromExit(1), 'error');
  assert.equal(outcomeFromExit(127), 'error');
});

test('logHookCall accrues fire/block/error counts per hook', () => {
  const { path: logPath, cleanup } = tmpLog();
  try {
    logHookCall({ hookId: 'guard', exitCode: 0, latencyMs: 4 }, { logPath });
    logHookCall({ hookId: 'guard', exitCode: 2, latencyMs: 6 }, { logPath });
    logHookCall({ hookId: 'guard', exitCode: 0 }, { logPath });
    logHookCall({ hookId: 'flaky', exitCode: 1 }, { logPath });
    const { totalEvents, hooks } = summarizeHookCalls({ logPath });
    assert.equal(totalEvents, 4);
    assert.equal(hooks.guard.calls, 3);
    assert.equal(hooks.guard.blocked, 1);
    assert.equal(hooks.guard.errors, 0);
    assert.equal(hooks.flaky.errors, 1);
    assert.equal(hooks.guard.p50LatencyMs, 4);
  } finally { cleanup(); }
});

test('a missing hookId is dropped, not logged', () => {
  const { path: logPath, cleanup } = tmpLog();
  try {
    logHookCall({ exitCode: 0 }, { logPath });
    assert.equal(summarizeHookCalls({ logPath }).totalEvents, 0);
  } finally { cleanup(); }
});

test('CONSTRUCT_HOOK_TELEMETRY=off disables logging', () => {
  const { path: logPath, cleanup } = tmpLog();
  try {
    logHookCall({ hookId: 'guard', exitCode: 0 }, { logPath, env: { CONSTRUCT_HOOK_TELEMETRY: 'off' } });
    assert.equal(summarizeHookCalls({ logPath }).totalEvents, 0);
  } finally { cleanup(); }
});

test('findIdleHooks returns registered hooks that never fired', () => {
  const { path: logPath, cleanup } = tmpLog();
  try {
    logHookCall({ hookId: 'guard', exitCode: 0 }, { logPath });
    const idle = findIdleHooks({ logPath, allHookIds: ['guard', 'never-fires', 'also-idle'] });
    assert.deepEqual(idle.sort(), ['also-idle', 'never-fires']);
  } finally { cleanup(); }
});
