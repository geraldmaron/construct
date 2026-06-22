/**
 * beads-concurrent-write.functional.test.mjs — parallel bd writes via optimistic locking.
 *
 * Proves construct beads routing survives concurrent write attempts without the
 * retired exclusive file-lock fallback (bead construct-nhn5 stage 2).
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { runBd, runBdJson } from '../../lib/beads-client.mjs';

const REPO = process.cwd();

function bdAvailable() {
  try {
    return spawnSync('bd', ['--version'], { encoding: 'utf8' }).status === 0;
  } catch {
    return false;
  }
}

test('parallel construct beads notes succeed without legacy lock fallback', async (t) => {
  if (!bdAvailable()) {
    t.skip('bd not installed — skip live beads concurrency test on CI');
    return;
  }
  const ready = await runBdJson(['ready', '-n', '1'], { cwd: REPO, silent: true });
  const targetId = ready?.[0]?.id || ready?.[0]?.issue_id || null;
  if (!targetId) {
    t.skip('no open bead available for concurrent note test');
    return;
  }

  const stamp = `concurrent-${Date.now()}`;
  const results = await Promise.all(
    Array.from({ length: 4 }, (_, i) => runBd(
      ['note', targetId, `${stamp}-${i}`],
      { cwd: REPO, actor: `test-${i}`, silent: true, fallbackToLegacy: false },
    )),
  );

  const successes = results.filter((r) => r.success);
  assert.ok(successes.length >= 1, 'at least one concurrent note should succeed');
  assert.ok(
    results.every((r) => r.method !== 'legacy-lock'),
    'retired legacy-lock path must not be used',
  );
});

test('fallbackToLegacy:false surfaces optimistic failure without queueing', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'beads-no-legacy-'));
  try {
    const result = await runBd(['update', 'construct-nope', '--claim'], {
      cwd: dir,
      silent: true,
      fallbackToLegacy: false,
      useOptimisticLocking: true,
    });
    assert.equal(result.success, false);
    assert.notEqual(result.method, 'legacy-lock');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
