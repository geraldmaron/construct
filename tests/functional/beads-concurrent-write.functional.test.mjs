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
import { runBd } from '../../lib/beads-client.mjs';

function bdAvailable() {
  try {
    return spawnSync('bd', ['--version'], { encoding: 'utf8' }).status === 0;
  } catch {
    return false;
  }
}

// A fresh dolt-backed bd store, isolated from the real repo tracker. Every
// caller in this file must run concurrent writes against this fixture, never
// against process.cwd()'s real .beads store (tests/functional/README.md).

function makeBeadsFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'beads-concurrent-'));
  const env = { ...process.env, CI: 'true', BD_NON_INTERACTIVE: '1' };
  spawnSync('git', ['init', '--quiet', '--initial-branch=main'], { cwd: dir });
  spawnSync('git', ['config', 'user.email', 'beads-test@example.com'], { cwd: dir });
  spawnSync('git', ['config', 'user.name', 'Beads Test'], { cwd: dir });
  const init = spawnSync('bd', ['init', '--non-interactive', '--prefix', 'bdfx'], {
    cwd: dir, encoding: 'utf8', env, timeout: 60_000,
  });
  if (init.status !== 0) {
    rmSync(dir, { recursive: true, force: true });
    throw new Error(`bd init failed in fixture: ${init.stderr || init.stdout}`);
  }
  const created = spawnSync('bd', ['create', 'fixture task', '--json'], {
    cwd: dir, encoding: 'utf8', env, timeout: 30_000,
  });
  if (created.status !== 0) {
    rmSync(dir, { recursive: true, force: true });
    throw new Error(`bd create failed in fixture: ${created.stderr || created.stdout}`);
  }
  const beadId = JSON.parse(created.stdout).id;
  return {
    dir,
    beadId,
    cleanup: () => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }),
  };
}

test('parallel construct beads notes succeed without legacy lock fallback', async (t) => {
  if (!bdAvailable()) {
    t.skip('bd not installed — skip live beads concurrency test on CI');
    return;
  }
  const fixture = makeBeadsFixture();
  t.after(fixture.cleanup);

  const targetId = fixture.beadId;
  const stamp = `concurrent-${Date.now()}`;
  const results = await Promise.all(
    Array.from({ length: 4 }, (_, i) => runBd(
      ['note', targetId, `${stamp}-${i}`],
      { cwd: fixture.dir, actor: `test-${i}`, silent: true, fallbackToLegacy: false },
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
