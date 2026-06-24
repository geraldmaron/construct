/**
 * tests/maintenance-cleanup.test.mjs — self-maintenance primitives.
 *
 * Covers the cleanup primitives that run on version upgrade and via
 * `construct cleanup`. The version-stamp logic is the trigger; the
 * primitives do the actual work.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  cleanupEmbedLog,
  cleanupJsonlLogs,
  cleanupCacheDir,
  runFullCleanup,
  formatBytes,
  readVersionStamp,
  writeVersionStamp,
  stampPath,
  maybeRunCleanupOnUpgrade,
} from '../lib/maintenance/cleanup.mjs';
import { stateDir, cacheDir, doctorRoot } from '../lib/config/xdg.mjs';

function mkHome() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-cleanup-'));
  fs.mkdirSync(path.join(doctorRoot(dir), 'runtime'), { recursive: true });
  fs.mkdirSync(cacheDir(dir), { recursive: true });
  return dir;
}

function writeSized(p, sizeBytes) {
  fs.writeFileSync(p, Buffer.alloc(sizeBytes, 'x'));
}

describe('cleanupEmbedLog', () => {
  it('does nothing when no runtime dir exists', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-cleanup-'));
    const summary = cleanupEmbedLog({ homeDir: dir });
    assert.equal(summary.removed.length, 0);
    assert.equal(summary.truncated.length, 0);
    assert.equal(summary.freedBytes, 0);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('truncates the live log in place when oversized', () => {
    const home = mkHome();
    const log = path.join(doctorRoot(home),'runtime', 'embed-daemon.log');
    writeSized(log, 2 * 1024 * 1024);
    const summary = cleanupEmbedLog({ homeDir: home, env: { CONSTRUCT_EMBED_LOG_MAX_MB: '1' } });
    assert.equal(summary.truncated.length, 1);
    assert.ok(fs.existsSync(log), 'live log path preserved');
    assert.equal(fs.statSync(log).size, 0, 'live log truncated in place');
    assert.equal(summary.freedBytes, 2 * 1024 * 1024);
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('drops rotated segments beyond the keep horizon', () => {
    const home = mkHome();
    const dir = path.join(doctorRoot(home),'runtime');
    // Live log is small (under cap), but segments .1 through .5 exist
    writeSized(path.join(dir, 'embed-daemon.log'), 1024);
    for (let n = 1; n <= 5; n++) {
      writeSized(path.join(dir, `embed-daemon.log.${n}`), 1024);
    }
    const summary = cleanupEmbedLog({ homeDir: home, env: { CONSTRUCT_EMBED_LOG_KEEP: '3' } });
    // Segments .4 and .5 are beyond keep=3, should be removed
    assert.equal(summary.removed.length, 2);
    assert.ok(!fs.existsSync(path.join(dir, 'embed-daemon.log.4')));
    assert.ok(!fs.existsSync(path.join(dir, 'embed-daemon.log.5')));
    assert.ok(fs.existsSync(path.join(dir, 'embed-daemon.log.3')));
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('removes individually oversized rotated segments', () => {
    const home = mkHome();
    const dir = path.join(doctorRoot(home),'runtime');
    writeSized(path.join(dir, 'embed-daemon.log'), 1024);
    writeSized(path.join(dir, 'embed-daemon.log.1'), 2 * 1024 * 1024); // oversized
    writeSized(path.join(dir, 'embed-daemon.log.2'), 1024);            // small
    const summary = cleanupEmbedLog({ homeDir: home, env: { CONSTRUCT_EMBED_LOG_MAX_MB: '1' } });
    assert.equal(summary.removed.length, 1);
    assert.equal(summary.removed[0].path, path.join(dir, 'embed-daemon.log.1'));
    assert.ok(!fs.existsSync(path.join(dir, 'embed-daemon.log.1')));
    assert.ok(fs.existsSync(path.join(dir, 'embed-daemon.log.2')));
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('dry-run reports what would be freed without touching files', () => {
    const home = mkHome();
    const log = path.join(doctorRoot(home),'runtime', 'embed-daemon.log');
    writeSized(log, 2 * 1024 * 1024);
    const summary = cleanupEmbedLog({
      homeDir: home,
      env: { CONSTRUCT_EMBED_LOG_MAX_MB: '1' },
      dryRun: true,
    });
    assert.equal(summary.freedBytes, 2 * 1024 * 1024);
    assert.equal(fs.statSync(log).size, 2 * 1024 * 1024, 'file untouched in dry-run');
    fs.rmSync(home, { recursive: true, force: true });
  });
});

describe('cleanupJsonlLogs', () => {
  it('preserves recent records when truncating an oversized jsonl', () => {
    const home = mkHome();
    const file = path.join(doctorRoot(home),'audit.jsonl');
    // Build a jsonl that exceeds the 25 MB cap
    const recent = Buffer.from('{"event":"recent","ts":"2026-05-27T12:00:00Z"}\n');
    const padding = Buffer.alloc(26 * 1024 * 1024, 'x');
    fs.writeFileSync(file, Buffer.concat([padding, recent]));
    const summary = cleanupJsonlLogs({ homeDir: home });
    assert.equal(summary.truncated.length, 1);
    assert.ok(fs.statSync(file).size < 26 * 1024 * 1024, 'truncated');
    const after = fs.readFileSync(file, 'utf8');
    assert.ok(after.includes('"event":"recent"'), 'recent event preserved');
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('does not touch small jsonl files', () => {
    const home = mkHome();
    const file = path.join(doctorRoot(home),'audit.jsonl');
    fs.writeFileSync(file, '{"event":"a"}\n{"event":"b"}\n');
    const before = fs.statSync(file).size;
    const summary = cleanupJsonlLogs({ homeDir: home });
    assert.equal(summary.truncated.length, 0);
    assert.equal(fs.statSync(file).size, before);
    fs.rmSync(home, { recursive: true, force: true });
  });
});

describe('cleanupCacheDir', () => {
  it('removes files older than maxAgeDays', () => {
    const home = mkHome();
    const cache = cacheDir(home);
    fs.mkdirSync(cache, { recursive: true });
    const oldFile = path.join(cache, 'old.json');
    const newFile = path.join(cache, 'new.json');
    fs.writeFileSync(oldFile, 'old');
    fs.writeFileSync(newFile, 'new');
    const oldMs = Date.now() - (60 * 24 * 60 * 60 * 1000); // 60 days ago
    fs.utimesSync(oldFile, oldMs / 1000, oldMs / 1000);

    const summary = cleanupCacheDir({ homeDir: home, maxAgeDays: 30 });
    assert.equal(summary.removed.length, 1);
    assert.ok(!fs.existsSync(oldFile), 'old removed');
    assert.ok(fs.existsSync(newFile), 'new preserved');
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('is a no-op when the cache dir does not exist', () => {
    const home = mkHome();
    const summary = cleanupCacheDir({ homeDir: home });
    assert.equal(summary.removed.length, 0);
    assert.equal(summary.freedBytes, 0);
    fs.rmSync(home, { recursive: true, force: true });
  });
});

describe('runFullCleanup', () => {
  it('aggregates freedBytes across primitives', () => {
    const home = mkHome();
    writeSized(path.join(doctorRoot(home),'runtime', 'embed-daemon.log'), 2 * 1024 * 1024);
    const audit = path.join(doctorRoot(home),'audit.jsonl');
    fs.writeFileSync(audit, Buffer.concat([Buffer.alloc(26 * 1024 * 1024, 'x'), Buffer.from('{"e":"k"}\n')]));

    const summary = runFullCleanup({
      homeDir: home,
      env: { CONSTRUCT_EMBED_LOG_MAX_MB: '1' },
    });

    assert.ok(summary.freedBytes > 2 * 1024 * 1024, 'embed log alone freed > 2 MB');
    assert.ok(summary.embedLog);
    assert.ok(summary.jsonlLogs);
    assert.ok(Array.isArray(summary.errors));
    assert.ok(summary.durationMs >= 0);
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('records errors from a failing primitive but continues', () => {
    // Pass a homeDir we can't write to. Best effort: use a path that doesn't
    // exist as a directory but expects to.
    const home = mkHome();
    // Replace the .cx/runtime dir with a file so primitives fail
    fs.rmSync(path.join(doctorRoot(home),'runtime'), { recursive: true });
    fs.writeFileSync(path.join(doctorRoot(home),'runtime'), 'i am a file');
    const summary = runFullCleanup({ homeDir: home, env: {} });
    // Should still complete, just with embedLog possibly degraded
    assert.ok(Array.isArray(summary.errors));
    assert.ok(summary.durationMs >= 0);
    fs.rmSync(home, { recursive: true, force: true });
  });
});

describe('formatBytes', () => {
  it('formats common sizes', () => {
    assert.equal(formatBytes(0), '0 B');
    assert.equal(formatBytes(1024), '1.0 KB');
    assert.equal(formatBytes(1.5 * 1024 * 1024), '1.5 MB');
    assert.equal(formatBytes(34 * 1024 * 1024 * 1024), '34.0 GB');
  });
});

describe('version stamp and auto-upgrade trigger', () => {
  it('writes and reads a stamp with the current version', () => {
    const home = mkHome();
    writeVersionStamp({ homeDir: home, version: '1.2.3', summary: { freedBytes: 1024, durationMs: 5 } });
    const stamp = readVersionStamp({ homeDir: home });
    assert.equal(stamp.version, '1.2.3');
    assert.equal(stamp.freedBytes, 1024);
    assert.ok(stamp.ranAt);
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('returns null when no stamp exists', () => {
    const home = mkHome();
    assert.equal(readVersionStamp({ homeDir: home }), null);
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('first run with no stamp triggers cleanup and writes the stamp', () => {
    const home = mkHome();
    writeSized(path.join(doctorRoot(home),'runtime', 'embed-daemon.log'), 2 * 1024 * 1024);
    const result = maybeRunCleanupOnUpgrade({
      homeDir: home,
      env: { CONSTRUCT_EMBED_LOG_MAX_MB: '1' },
      currentVersion: '1.0.7',
    });
    assert.equal(result.ran, true);
    assert.equal(result.reason, 'first run');
    assert.equal(result.previousVersion, null);
    assert.ok(result.summary.freedBytes > 0);
    const stamp = readVersionStamp({ homeDir: home });
    assert.equal(stamp.version, '1.0.7');
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('matching stamp version skips cleanup', () => {
    const home = mkHome();
    writeVersionStamp({ homeDir: home, version: '1.0.7', summary: { freedBytes: 0, durationMs: 0 } });
    writeSized(path.join(doctorRoot(home),'runtime', 'embed-daemon.log'), 2 * 1024 * 1024);
    const result = maybeRunCleanupOnUpgrade({
      homeDir: home,
      env: { CONSTRUCT_EMBED_LOG_MAX_MB: '1' },
      currentVersion: '1.0.7',
    });
    assert.equal(result.ran, false);
    assert.equal(result.reason, 'version matches stamp');
    // Log was NOT cleaned because stamp matched
    assert.equal(fs.statSync(path.join(doctorRoot(home),'runtime', 'embed-daemon.log')).size, 2 * 1024 * 1024);
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('version mismatch triggers cleanup and updates the stamp', () => {
    const home = mkHome();
    writeVersionStamp({ homeDir: home, version: '1.0.6', summary: { freedBytes: 0, durationMs: 0 } });
    writeSized(path.join(doctorRoot(home),'runtime', 'embed-daemon.log'), 2 * 1024 * 1024);
    const result = maybeRunCleanupOnUpgrade({
      homeDir: home,
      env: { CONSTRUCT_EMBED_LOG_MAX_MB: '1' },
      currentVersion: '1.0.7',
    });
    assert.equal(result.ran, true);
    assert.equal(result.reason, 'version changed');
    assert.equal(result.previousVersion, '1.0.6');
    const stamp = readVersionStamp({ homeDir: home });
    assert.equal(stamp.version, '1.0.7');
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('CONSTRUCT_DISABLE_AUTO_CLEANUP=1 skips the trigger entirely', () => {
    const home = mkHome();
    writeSized(path.join(doctorRoot(home),'runtime', 'embed-daemon.log'), 2 * 1024 * 1024);
    const result = maybeRunCleanupOnUpgrade({
      homeDir: home,
      env: { CONSTRUCT_DISABLE_AUTO_CLEANUP: '1', CONSTRUCT_EMBED_LOG_MAX_MB: '1' },
      currentVersion: '1.0.7',
    });
    assert.equal(result.ran, false);
    assert.ok(result.reason.includes('disabled'));
    assert.equal(readVersionStamp({ homeDir: home }), null, 'no stamp written when disabled');
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('force=true runs cleanup even when version matches', () => {
    const home = mkHome();
    writeVersionStamp({ homeDir: home, version: '1.0.7', summary: { freedBytes: 0, durationMs: 0 } });
    writeSized(path.join(doctorRoot(home),'runtime', 'embed-daemon.log'), 2 * 1024 * 1024);
    const result = maybeRunCleanupOnUpgrade({
      homeDir: home,
      env: { CONSTRUCT_EMBED_LOG_MAX_MB: '1' },
      currentVersion: '1.0.7',
      force: true,
    });
    assert.equal(result.ran, true);
    assert.ok(result.summary.freedBytes > 0);
    fs.rmSync(home, { recursive: true, force: true });
  });
});

describe('stampPath', () => {
  it('resolves under the XDG state dir', () => {
    const p = stampPath('/tmp/fakehome');
    assert.equal(p, path.join(stateDir('/tmp/fakehome'), '.cleanup-stamp'));
  });
});
