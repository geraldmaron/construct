/**
 * tests/functional/init-all-hosts-cursor.functional.test.mjs
 *
 * Isolation UX regression: `construct init --all-hosts` must materialise
 * `.cursor/mcp.json` (and rules) even when Cursor is not detected on PATH.
 * Also pins `--with-cursor` as a union with detection (does not replace).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BIN = join(REPO_ROOT, 'bin', 'construct');

function runInit(dir, home, extraArgs = []) {
  return spawnSync(
    process.execPath,
    [BIN, 'init', '--yes', '--no-start', '--no-beads', ...extraArgs],
    {
      cwd: dir,
      encoding: 'utf8',
      timeout: 120_000,
      env: {
        ...process.env,
        CONSTRUCT_SKIP_BOOTSTRAP_PROBE: '1',
        BOOTSTRAP_CHECKED: '1',
        HOME: home,
        CONSTRUCT_HOME_OVERRIDE: home,
        PATH: '/usr/bin:/bin',
      },
    },
  );
}

test('construct init --all-hosts creates .cursor/ in an isolated tmpdir', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'init-all-hosts-'));
  const home = mkdtempSync(join(tmpdir(), 'init-all-hosts-home-'));
  t.after(() => {
    rmTmpDir(dir);
    rmTmpDir(home);
  });

  spawnSync('git', ['init', '--quiet', '--initial-branch=main'], { cwd: dir });
  const result = runInit(dir, home, ['--all-hosts']);
  assert.equal(result.status, 0, `init exited ${result.status}: ${result.stderr}\n${result.stdout}`);
  assert.ok(existsSync(join(dir, '.cursor', 'mcp.json')), 'expected .cursor/mcp.json after --all-hosts');
  assert.ok(existsSync(join(dir, '.cursor', 'rules', 'construct.mdc')), 'expected .cursor/rules/construct.mdc');
  assert.ok(existsSync(join(dir, '.claude', 'settings.json')), 'expected .claude/ still present under --all-hosts');
});

test('construct init --with-cursor unions Cursor without requiring Cursor on PATH', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'init-with-cursor-'));
  const home = mkdtempSync(join(tmpdir(), 'init-with-cursor-home-'));
  t.after(() => {
    rmTmpDir(dir);
    rmTmpDir(home);
  });

  mkdirSync(join(home, '.claude'), { recursive: true });
  writeFileSync(join(home, '.claude', 'settings.json'), '{}\n');

  spawnSync('git', ['init', '--quiet', '--initial-branch=main'], { cwd: dir });
  const result = runInit(dir, home, ['--with-cursor']);
  assert.equal(result.status, 0, `init exited ${result.status}: ${result.stderr}\n${result.stdout}`);
  assert.ok(existsSync(join(dir, '.cursor', 'mcp.json')), 'expected .cursor/mcp.json after --with-cursor');
});
