/**
 * tests/writes/sent-log.test.mjs — WriteSentLog persist/load fault-injection.
 *
 * lib/writes/sent-log.mjs is the only cross-process idempotency-dedup record
 * for external writes (Jira comments, Slack messages, etc). These tests prove
 * that a persist or load failure surfaces as an explicit thrown error rather
 * than being silently swallowed, and that a failed persist never corrupts a
 * prior successful write (the temp-file-then-rename record survives).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { WriteSentLog } from '../../lib/writes/sent-log.mjs';

function makeTmpDir() {
  return mkdtempSync(join(tmpdir(), 'sentlog-fault-'));
}

describe('WriteSentLog fault injection', () => {
  it('record() throws when the persist directory cannot be created, instead of silently dropping the entry', () => {
    const dir = makeTmpDir();
    try {
      const blockerFile = join(dir, 'blocker');
      writeFileSync(blockerFile, 'not a directory', 'utf8');

      const persistPath = join(blockerFile, 'sent-log.jsonl');
      const log = new WriteSentLog({ persistPath });

      assert.throws(() => {
        log.record({ idempotencyKey: 'k1', writeType: 'issue', provider: 'github', status: 'sent' });
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a failed persist does not corrupt a prior successful record: the dedup key survives on disk', () => {
    const dir = makeTmpDir();
    try {
      const persistPath = join(dir, 'sent-log.jsonl');
      const log = new WriteSentLog({ persistPath });

      log.record({ idempotencyKey: 'good-key', writeType: 'issue', provider: 'github', status: 'sent' });
      const onDiskAfterFirst = readFileSync(persistPath, 'utf8');
      assert.match(onDiskAfterFirst, /good-key/);

      rmSync(persistPath, { force: true });
      mkdirSync(persistPath);

      assert.throws(() => {
        log.record({ idempotencyKey: 'lost-key', writeType: 'issue', provider: 'github', status: 'sent' });
      });

      rmSync(persistPath, { recursive: true, force: true });
      writeFileSync(persistPath, onDiskAfterFirst, 'utf8');

      const reloaded = new WriteSentLog({ persistPath });
      assert.equal(reloaded.findByIdempotencyKey('good-key').status, 'sent');
      assert.equal(reloaded.findByIdempotencyKey('lost-key'), null);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('pruneOlderThan() throws when persist fails, instead of silently discarding pruned state', () => {
    const dir = makeTmpDir();
    try {
      const persistPath = join(dir, 'sent-log.jsonl');
      const log = new WriteSentLog({ persistPath });
      log.record({ idempotencyKey: 'k1', writeType: 'issue', provider: 'github', status: 'sent', sentAt: new Date(0).toISOString() });

      rmSync(persistPath, { force: true });
      mkdirSync(persistPath);

      assert.throws(() => log.pruneOlderThan(1000));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('constructing WriteSentLog throws on a genuine I/O failure reading an existing persist path (not the missing-file case)', () => {
    const dir = makeTmpDir();
    try {
      const persistPath = join(dir, 'sent-log.jsonl');
      mkdirSync(persistPath);

      assert.throws(() => new WriteSentLog({ persistPath }));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a missing persist file is still the silent, expected case (no throw, empty log)', () => {
    const dir = makeTmpDir();
    try {
      const persistPath = join(dir, 'does-not-exist', 'sent-log.jsonl');
      const log = new WriteSentLog({ persistPath });
      assert.equal(log.list().length, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a single malformed JSONL line is still tolerated and skipped, unlike a genuine I/O failure', () => {
    const dir = makeTmpDir();
    try {
      const persistPath = join(dir, 'sent-log.jsonl');
      const goodRecord = JSON.stringify({ idempotencyKey: 'ok-key', writeType: 'issue', provider: 'github', status: 'sent' });
      writeFileSync(persistPath, `${goodRecord}\nnot valid json\n`, 'utf8');

      const log = new WriteSentLog({ persistPath });
      assert.equal(log.findByIdempotencyKey('ok-key').status, 'sent');
      assert.equal(log.list().length, 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('persist uses temp-file-then-rename: no stray .tmp files remain after a successful record()', () => {
    const dir = makeTmpDir();
    try {
      const persistPath = join(dir, 'sent-log.jsonl');
      const log = new WriteSentLog({ persistPath });
      log.record({ idempotencyKey: 'k1', writeType: 'issue', provider: 'github', status: 'sent' });
      log.record({ idempotencyKey: 'k2', writeType: 'issue', provider: 'github', status: 'sent' });

      const entries = readdirSync(dir);
      const tmpFiles = entries.filter(f => f.includes('.tmp'));
      assert.deepEqual(tmpFiles, []);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
