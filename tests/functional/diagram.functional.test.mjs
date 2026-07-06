/**
 * diagram.functional.test.mjs — `construct diagram` smoke gate.
 *
 * @capability diagram.graceful-render
 *
 * Contract: source is ALWAYS produced and the command ALWAYS exits 0,
 * whether or not a renderer binary (D2 / Graphviz dot) is present. When a
 * renderer IS present, a rendered SVG must also appear. This asserts the
 * graceful-degradation guarantee from ADR-0001 (zero-npm-core): rendering
 * goes through external system binaries detected at runtime, and absence
 * degrades to source-only output rather than crashing.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';

import { locateRenderer } from '../../lib/diagram.mjs';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const BIN = path.join(REPO, 'bin', 'construct');

// lib/paths.mjs resolves the machine-scoped state root (ADR-0066) from
// process.env directly, so every spawned `construct` needs its own sandboxed
// HOME to avoid leaking test projects into the real developer machine's
// ~/.construct/projects/.

const SANDBOX_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'diagram-home-'));
process.on('exit', () => fs.rmSync(SANDBOX_HOME, { recursive: true, force: true }));

function run(args, cwd) {
  return spawnSync(BIN, args, {
    cwd,
    encoding: 'utf8',
    timeout: 90_000,
    env: {
      ...process.env,
      CONSTRUCT_SKIP_BOOTSTRAP_PROBE: '1',
      BOOTSTRAP_CHECKED: '1',
      CONSTRUCT_DISABLE_AUTO_CLEANUP: '1',
      HOME: SANDBOX_HOME,
      CX_HOME_OVERRIDE: SANDBOX_HOME,
    },
  });
}

test('construct diagram: source always produced; SVG when renderer present; exit 0', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'diagram-'));
  try {
    const result = run(['diagram', 'web app: client -> api -> db'], dir);
    assert.equal(result.status, 0, `expected exit 0, got ${result.status}. stderr: ${result.stderr}`);

    const outDir = path.join(dir, '.cx', 'diagrams');
    assert.ok(fs.existsSync(outDir), 'expected .cx/diagrams/ to exist');
    const files = fs.readdirSync(outDir);

    const sourceFiles = files.filter((f) => /\.(d2|dot|md)$/.test(f));
    assert.ok(sourceFiles.length >= 1, `expected a source file (.d2/.dot/.md); got: ${files.join(', ')}`);

    if (locateRenderer()) {
      const svgFiles = files.filter((f) => f.endsWith('.svg'));
      assert.ok(svgFiles.length >= 1, `renderer present but no SVG produced; got: ${files.join(', ')}`);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('construct diagram --source-only: writes source, exits 0, no render', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'diagram-src-'));
  try {
    const result = run(['diagram', 'client -> api -> db', '--source-only'], dir);
    assert.equal(result.status, 0, `expected exit 0, got ${result.status}. stderr: ${result.stderr}`);
    const files = fs.readdirSync(path.join(dir, '.cx', 'diagrams'));
    assert.ok(files.some((f) => f.endsWith('.d2')), `expected .d2 source; got: ${files.join(', ')}`);
    assert.ok(!files.some((f) => /\.(svg|png)$/.test(f)), `--source-only should not render; got: ${files.join(', ')}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
