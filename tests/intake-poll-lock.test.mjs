/**
 * tests/intake-poll-lock.test.mjs — pid-stamped poll lock unit tests.
 *
 * Asserts the acquire / release contract, stale-lock cleanup on dead pids
 * and expired timeouts, fail-fast behavior when the holder is alive, and
 * the POLL_LOCK_BUSY error shape consumers depend on.
 */

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  acquirePollLock,
  releasePollLock,
  readPollLock,
  isPollLockStale,
  POLL_LOCK_REL_PATH,
  POLL_LOCK_BUSY,
} from '../lib/intake/poll-lock.mjs';

let rootDir;

beforeEach(() => {
  rootDir = mkdtempSync(join(tmpdir(), 'poll-lock-'));
  mkdirSync(join(rootDir, '.construct', 'runtime'), { recursive: true });
});

afterEach(() => {
  rmSync(rootDir, { recursive: true, force: true });
});

test('acquirePollLock writes the lockfile with this process pid', async () => {
  const lock = await acquirePollLock({ rootDir, actor: 'test', command: 'unit' });
  assert.equal(lock.pid, process.pid);
  assert.equal(lock.actor, 'test');
  assert.equal(lock.command, 'unit');
  assert.ok(typeof lock.startedAt === 'string');

  const onDisk = JSON.parse(readFileSync(join(rootDir, POLL_LOCK_REL_PATH), 'utf8'));
  assert.equal(onDisk.pid, process.pid);
});

test('releasePollLock removes the lockfile when this process owns it', async () => {
  await acquirePollLock({ rootDir, actor: 'test' });
  const released = releasePollLock(rootDir);
  assert.equal(released, true);
  assert.equal(existsSync(join(rootDir, POLL_LOCK_REL_PATH)), false);
});

test('releasePollLock is a no-op when the lock is owned by another pid', async () => {
  writeFileSync(
    join(rootDir, POLL_LOCK_REL_PATH),
    JSON.stringify({ pid: 999999, actor: 'other', startedAt: new Date().toISOString() }),
    'utf8',
  );
  const released = releasePollLock(rootDir);
  assert.equal(released, false);
  assert.ok(existsSync(join(rootDir, POLL_LOCK_REL_PATH)), 'foreign lock must survive');
});

test('acquirePollLock fails fast with POLL_LOCK_BUSY when a live holder exists', async () => {
  writeFileSync(
    join(rootDir, POLL_LOCK_REL_PATH),
    JSON.stringify({ pid: process.pid, actor: 'self-held', startedAt: new Date().toISOString() }),
    'utf8',
  );
  await assert.rejects(
    acquirePollLock({ rootDir, actor: 'second', waitMs: 0 }),
    (err) => {
      assert.equal(err.code, POLL_LOCK_BUSY, `wrong code: ${err.code}`);
      assert.ok(err.holder, 'error must carry holder metadata');
      assert.equal(err.holder.actor, 'self-held');
      return true;
    },
  );
});

test('acquirePollLock clears a stale lock whose pid is gone', async () => {
  writeFileSync(
    join(rootDir, POLL_LOCK_REL_PATH),
    JSON.stringify({ pid: 999999, actor: 'dead', startedAt: new Date().toISOString() }),
    'utf8',
  );
  const lock = await acquirePollLock({ rootDir, actor: 'fresh' });
  assert.equal(lock.pid, process.pid);
  assert.equal(lock.actor, 'fresh');
});

test('acquirePollLock clears a stale lock whose timeoutAt has passed', async () => {
  writeFileSync(
    join(rootDir, POLL_LOCK_REL_PATH),
    JSON.stringify({
      pid: process.pid,
      actor: 'self',
      startedAt: new Date(Date.now() - 60_000).toISOString(),
      timeoutAt: new Date(Date.now() - 1000).toISOString(),
    }),
    'utf8',
  );
  const lock = await acquirePollLock({ rootDir, actor: 'fresh' });
  assert.equal(lock.actor, 'fresh');
  assert.ok(new Date(lock.startedAt).getTime() > Date.now() - 5_000);
});

test('acquirePollLock waits for a holder to release within waitMs', async () => {
  writeFileSync(
    join(rootDir, POLL_LOCK_REL_PATH),
    JSON.stringify({ pid: process.pid, actor: 'first', startedAt: new Date().toISOString() }),
    'utf8',
  );

  const release = setTimeout(() => {
    rmSync(join(rootDir, POLL_LOCK_REL_PATH), { force: true });
  }, 150);

  try {
    const lock = await acquirePollLock({ rootDir, actor: 'second', waitMs: 1000, pollIntervalMs: 25 });
    assert.equal(lock.actor, 'second');
  } finally {
    clearTimeout(release);
  }
});

test('isPollLockStale recognizes dead pids and expired timeouts', () => {
  assert.equal(isPollLockStale(null), false);
  assert.equal(isPollLockStale({ pid: 999999 }), true);
  assert.equal(isPollLockStale({ pid: process.pid }), false);
  assert.equal(isPollLockStale({ pid: process.pid, timeoutAt: new Date(Date.now() - 1000).toISOString() }), true);
});

test('readPollLock returns null when no lock exists or the file is corrupt', () => {
  assert.equal(readPollLock(rootDir), null);
  writeFileSync(join(rootDir, POLL_LOCK_REL_PATH), '{not valid', 'utf8');
  assert.equal(readPollLock(rootDir), null);
});
