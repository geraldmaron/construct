/**
 * tests/storage-file-lock.test.mjs — file-lock primitive tests.
 *
 * Asserts:
 *   - Two concurrent writers serialize through the lock (the second waits
 *     until the first releases).
 *   - A stale lock (PID belongs to a dead process) is stolen rather than
 *     blocking forever.
 *   - The lock is released even when the wrapped function throws.
 *   - The sync variant honours the same contract.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, before, after } from 'node:test';
import { withFileLock, withFileLockSync } from '../lib/storage/file-lock.mjs';

let tmpDir;
let target;

before(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-file-lock-'));
  target = path.join(tmpDir, 'shared.json');
});

after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('withFileLock', () => {
  it('serializes concurrent writers', async () => {
    const order = [];
    const slow = withFileLock(target, async () => {
      order.push('slow:start');
      await new Promise((r) => setTimeout(r, 80));
      order.push('slow:end');
    });
    const fast = withFileLock(target, async () => {
      order.push('fast:start');
      order.push('fast:end');
    });
    await Promise.all([slow, fast]);
    assert.deepEqual(order, ['slow:start', 'slow:end', 'fast:start', 'fast:end']);
  });

  it('releases the lock even when the wrapped function throws', async () => {
    await assert.rejects(
      withFileLock(target, async () => { throw new Error('boom'); }),
      /boom/
    );
    assert.equal(fs.existsSync(`${target}.lock`), false, 'lock must be cleaned up after throw');
  });

  it('steals a stale lock (PID belongs to a dead process)', async () => {
    fs.writeFileSync(`${target}.lock`, '99999999');
    let ran = false;
    await withFileLock(target, async () => { ran = true; });
    assert.equal(ran, true);
  });

  it('sync variant runs and releases', () => {
    const result = withFileLockSync(target, () => 42);
    assert.equal(result, 42);
    assert.equal(fs.existsSync(`${target}.lock`), false);
  });
});
