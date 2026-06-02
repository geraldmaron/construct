/**
 * tests/op-log.test.mjs — per-operation structured log file.
 *
 * Asserts startOpLog writes a correlation-id-stamped JSONL trace under
 * <home>/.cx/, that every line shares the op_id, that close() stamps the
 * final status, and that a non-writable home degrades to a silent no-op
 * instead of throwing (logging must never break the operation).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { startOpLog } from '../lib/op-log.mjs';

function tmpHome(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('startOpLog writes a correlation-stamped JSONL trace and closes with status', () => {
  const home = tmpHome('op-log-home-');
  try {
    const opLog = startOpLog('dev', { homeDir: home });
    assert.ok(opLog.logPath, 'logPath must be set when the stream opened');
    assert.match(path.basename(opLog.logPath), /^dev-.*\.log$/);
    assert.equal(path.dirname(opLog.logPath), path.join(home, '.cx'));

    opLog.event('services', { results: [{ name: 'Dashboard', status: 'started' }] });
    opLog.warn('embed', { status: 'failed' });
    opLog.close('degraded', { failed: ['Postgres'] });

    const lines = fs.readFileSync(opLog.logPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    const events = lines.map((l) => l.event);
    assert.deepEqual(events, ['op.start', 'services', 'embed', 'op.end']);

    const ids = new Set(lines.map((l) => l.op_id));
    assert.equal(ids.size, 1, 'every line shares one correlation id');
    assert.ok([...ids][0], 'op_id is non-empty');

    for (const line of lines) assert.equal(line.op, 'dev');
    assert.equal(lines.at(-1).level, 'info');
    assert.equal(lines.at(-1).status, 'degraded');
    assert.deepEqual(lines.at(-1).failed, ['Postgres']);
    assert.equal(lines.find((l) => l.event === 'embed').level, 'warn');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('startOpLog degrades to a no-op when the log file cannot be opened', () => {
  // Point home at a path whose .cx is a *file*, so mkdir/createWriteStream fail.
  const home = tmpHome('op-log-bad-');
  try {
    fs.writeFileSync(path.join(home, '.cx'), 'not a directory');
    let opLog;
    assert.doesNotThrow(() => { opLog = startOpLog('sync', { homeDir: home }); });
    assert.equal(opLog.logPath, null, 'logPath is null when the stream could not open');
    assert.doesNotThrow(() => {
      opLog.event('args', { args: ['--global'] });
      opLog.close('ok');
    });
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
