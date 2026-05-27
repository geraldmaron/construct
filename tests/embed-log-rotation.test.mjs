/**
 * tests/embed-log-rotation.test.mjs — log rotation at daemon spawn time.
 *
 * The embed daemon writes stdout/stderr to ~/.cx/runtime/embed-daemon.log
 * via a parent-opened file descriptor. Rotation must happen BEFORE the
 * spawn opens the FD, otherwise the daemon writes into the rotated file.
 * These tests cover the rotation primitive directly so the spawn callers
 * stay simple.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { rotateEmbedLogIfNeeded } from '../lib/embed/cli.mjs';

function makeTmpLog(sizeBytes) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-log-rot-'));
  const log = path.join(tmpDir, 'embed-daemon.log');
  if (sizeBytes > 0) fs.writeFileSync(log, Buffer.alloc(sizeBytes, 'x'));
  return { tmpDir, log };
}

describe('rotateEmbedLogIfNeeded', () => {
  it('does nothing when the log does not exist', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-log-rot-'));
    const log = path.join(tmpDir, 'embed-daemon.log');
    const result = rotateEmbedLogIfNeeded(log, {});
    assert.equal(result.rotated, false);
    assert.equal(result.sizeBytes, 0);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('does not rotate when the log is under the size cap', () => {
    // 1 MB log, 50 MB default cap
    const { tmpDir, log } = makeTmpLog(1024 * 1024);
    const result = rotateEmbedLogIfNeeded(log, {});
    assert.equal(result.rotated, false);
    assert.ok(fs.existsSync(log));
    assert.ok(!fs.existsSync(`${log}.1`));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('rotates when the log exceeds the configured cap', () => {
    // 2 MB log, 1 MB cap via env
    const { tmpDir, log } = makeTmpLog(2 * 1024 * 1024);
    const result = rotateEmbedLogIfNeeded(log, { CONSTRUCT_EMBED_LOG_MAX_MB: '1' });
    assert.equal(result.rotated, true);
    assert.ok(!fs.existsSync(log), 'live log should be moved aside');
    assert.ok(fs.existsSync(`${log}.1`), 'should be rotated to .1');
    assert.equal(fs.statSync(`${log}.1`).size, 2 * 1024 * 1024);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('shifts existing segments and drops the oldest beyond the keep count', () => {
    const { tmpDir, log } = makeTmpLog(2 * 1024 * 1024);
    // Seed existing segments .1, .2, .3 with distinguishable content
    fs.writeFileSync(`${log}.1`, 'segment-1');
    fs.writeFileSync(`${log}.2`, 'segment-2');
    fs.writeFileSync(`${log}.3`, 'segment-3');

    const result = rotateEmbedLogIfNeeded(log, {
      CONSTRUCT_EMBED_LOG_MAX_MB: '1',
      CONSTRUCT_EMBED_LOG_KEEP: '3',
    });

    assert.equal(result.rotated, true);
    assert.equal(result.droppedSegment, `${log}.3`);
    assert.ok(!fs.existsSync(log), 'live log moved aside');
    assert.equal(fs.statSync(`${log}.1`).size, 2 * 1024 * 1024, 'live → .1');
    assert.equal(fs.readFileSync(`${log}.2`, 'utf8'), 'segment-1', 'old .1 → .2');
    assert.equal(fs.readFileSync(`${log}.3`, 'utf8'), 'segment-2', 'old .2 → .3');
    assert.ok(!fs.existsSync(`${log}.4`), 'never creates a segment beyond keep');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('keep=0 discards the log entirely instead of retaining a segment', () => {
    const { tmpDir, log } = makeTmpLog(2 * 1024 * 1024);
    const result = rotateEmbedLogIfNeeded(log, {
      CONSTRUCT_EMBED_LOG_MAX_MB: '1',
      CONSTRUCT_EMBED_LOG_KEEP: '0',
    });
    assert.equal(result.rotated, true);
    assert.ok(!fs.existsSync(log), 'log removed');
    assert.ok(!fs.existsSync(`${log}.1`), 'no segment kept');
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('clamps absurd CONSTRUCT_EMBED_LOG_MAX_MB to the hard cap', () => {
    // 600 MB requested, but hard cap is 500 MB. With a 1 MB file, no rotation.
    const { tmpDir, log } = makeTmpLog(1024 * 1024);
    const result = rotateEmbedLogIfNeeded(log, { CONSTRUCT_EMBED_LOG_MAX_MB: '9999' });
    assert.equal(result.rotated, false, '1 MB file should not rotate even with clamp');
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('falls back to defaults when env vars are non-numeric', () => {
    const { tmpDir, log } = makeTmpLog(1024 * 1024);
    const result = rotateEmbedLogIfNeeded(log, {
      CONSTRUCT_EMBED_LOG_MAX_MB: 'banana',
      CONSTRUCT_EMBED_LOG_KEEP: 'fruit',
    });
    // 1 MB << 50 MB default cap
    assert.equal(result.rotated, false);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
