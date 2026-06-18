/**
 * demo.functional.test.mjs — `construct demo` smoke gate.
 *
 * Contract: the `.tape` source is ALWAYS produced and the command ALWAYS
 * exits 0, whether or not a recorder binary (VHS / asciinema) is present.
 * When a recorder IS present, a recording artifact must also appear. This
 * asserts the graceful-degradation guarantee from ADR-0001 (zero-npm-core):
 * recording goes through external system binaries detected at runtime, and
 * absence degrades to source-only output rather than crashing.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';

import { locateRecorder } from '../../lib/demo.mjs';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const BIN = path.join(REPO, 'bin', 'construct');

function run(args, cwd) {
  return spawnSync(BIN, args, {
    cwd,
    encoding: 'utf8',
    timeout: 200_000,
    env: { ...process.env, CONSTRUCT_SKIP_BOOTSTRAP_PROBE: '1', BOOTSTRAP_CHECKED: '1', CONSTRUCT_DISABLE_AUTO_CLEANUP: '1' },
  });
}

test('construct demo: tape always produced; recording when recorder present; exit 0', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-'));
  try {
    const recorder = locateRecorder();
    const result = run(['demo', 'quickstart'], dir);
    assert.equal(result.status, 0, `expected exit 0, got ${result.status}. stderr: ${result.stderr}`);

    const outDir = path.join(dir, '.cx', 'demos');
    assert.ok(fs.existsSync(outDir), 'expected .cx/demos/ to exist');
    const files = fs.readdirSync(outDir);

    assert.ok(files.some((f) => f.endsWith('.tape')), `expected a .tape source; got: ${files.join(', ')}`);

    if (recorder) {
      const artifacts = files.filter((f) => /\.(gif|mp4|webm|cast)$/.test(f));
      assert.ok(artifacts.length >= 1, `recorder present but no recording produced; got: ${files.join(', ')}`);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('construct demo --source-only: writes tape, exits 0, no recording', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-src-'));
  try {
    const result = run(['demo', 'quickstart', '--source-only'], dir);
    assert.equal(result.status, 0, `expected exit 0, got ${result.status}. stderr: ${result.stderr}`);
    const files = fs.readdirSync(path.join(dir, '.cx', 'demos'));
    assert.ok(files.some((f) => f.endsWith('.tape')), `expected .tape source; got: ${files.join(', ')}`);
    assert.ok(!files.some((f) => /\.(gif|mp4|webm|cast)$/.test(f)), `--source-only should not record; got: ${files.join(', ')}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
