/**
 * tests/next-build-lock.test.mjs — Contract for the cross-process next-build
 * mutex that keeps the dashboard-build suite and the dashboard server suites
 * from running `next build` against the same distDir at once. Covers mutual
 * exclusion, the acquire timeout, and stale-holder recovery.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { withNextBuildLock, lockPathFor } from './functional/_lib/next-build-lock.mjs';

test('serializes concurrent holders of the same key', async () => {
  const key = `mutex-${process.pid}`;
  let active = 0;
  let maxActive = 0;
  const trace = [];
  const task = (id) => withNextBuildLock(key, async () => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    trace.push(`enter ${id}`);
    await new Promise((r) => setTimeout(r, 25));
    trace.push(`exit ${id}`);
    active -= 1;
  });

  await Promise.all([1, 2, 3, 4, 5].map(task));

  assert.equal(maxActive, 1, `critical sections overlapped: ${trace.join(', ')}`);
  assert.equal(active, 0);
});

test('throws when the lock stays held past the acquire timeout', async () => {
  const key = `timeout-${process.pid}`;
  let release;
  const held = new Promise((r) => { release = r; });
  let markEntered;
  const entered = new Promise((r) => { markEntered = r; });

  const holder = withNextBuildLock(key, async () => { markEntered(); await held; });
  await entered;

  await assert.rejects(
    withNextBuildLock(key, async () => 'unreached', { timeoutMs: 150, pollMs: 25 }),
    /not acquired within 150ms/,
  );

  release();
  await holder;
});

test('steals a lock left by a crashed (dead-pid) holder', async () => {
  const key = `stale-${process.pid}`;
  const lockPath = lockPathFor(key);

  // A finished spawnSync child has been reaped, so its pid is dead — the same
  // state a build worker killed mid-run leaves behind. Seeding the lockfile
  // with that pid forces acquire to reclaim the stale lock instead of waiting.

  const dead = spawnSync(process.execPath, ['-e', 'process.exit(0)']);
  writeFileSync(lockPath, String(dead.pid));

  try {
    const ran = await withNextBuildLock(key, async () => 'built', { timeoutMs: 2_000, pollMs: 25 });
    assert.equal(ran, 'built');
  } finally {
    rmSync(lockPath, { force: true });
  }
});
