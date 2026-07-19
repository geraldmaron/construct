/**
 * cli-help-safety.functional.test.mjs — every command must respect --help.
 *
 * Without this guard, destructive commands silently run when a user adds
 * --help. The original defect: `construct stop --help` stopped services,
 * `construct dev --help` started them, `construct init --help` scaffolded
 * a project. The top-level dispatch in bin/construct now intercepts --help
 * for every handler before invoking it; this test asserts that contract.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';

import { CLI_COMMANDS } from '../../lib/cli-commands.mjs';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const BIN = path.join(REPO, 'bin', 'construct');

// Isolated HOME so install/init can't touch the developer's real state.
function isolatedEnv() {
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-help-'));
  return {
    fakeHome,
    env: {
      ...process.env,
      HOME: fakeHome,
      CONSTRUCT_SKIP_BOOTSTRAP_PROBE: '1',
      BOOTSTRAP_CHECKED: '1',
      CONSTRUCT_DISABLE_AUTO_CLEANUP: '1',
    },
  };
}

// Commands we never want to invoke even with the guard in place — for
// extra paranoia, the test asserts they exit with help text, never side
// effects. The set lives here so a future regression can't quietly drop
// a destructive command from coverage.
const DESTRUCTIVE = ['dev', 'stop', 'init', 'uninstall', 'sync', 'install', 'upgrade', 'update', 'cleanup'];

test('every visible command exits 0 with --help and does not run its action', () => {
  const { fakeHome, env } = isolatedEnv();
  try {
    for (const spec of CLI_COMMANDS) {
      if (spec.internal) continue;
      const start = Date.now();
      const result = spawnSync(BIN, [spec.name, '--help'], {
        env,
        encoding: 'utf8',
        timeout: 5000,
      });
      const elapsed = Date.now() - start;
      assert.equal(
        result.status,
        0,
        `construct ${spec.name} --help should exit 0, got ${result.status}. stderr: ${result.stderr}`,
      );
      assert.ok(
        result.stdout.includes(`construct ${spec.name}`),
        `construct ${spec.name} --help should print the command name in its header. stdout: ${result.stdout.slice(0, 200)}`,
      );
      assert.ok(
        elapsed < 5000,
        `construct ${spec.name} --help took ${elapsed}ms; help should be fast`,
      );
    }
  } finally {
    rmTmpDir(fakeHome);
  }
});

test('-h is treated the same as --help for destructive commands', () => {
  const { fakeHome, env } = isolatedEnv();
  try {
    for (const name of DESTRUCTIVE) {
      const result = spawnSync(BIN, [name, '-h'], { env, encoding: 'utf8', timeout: 5000 });
      assert.equal(result.status, 0, `construct ${name} -h should exit 0`);
      assert.ok(
        result.stdout.includes(`construct ${name}`),
        `construct ${name} -h should print the command name in its header`,
      );
    }
  } finally {
    rmTmpDir(fakeHome);
  }
});

test('destructive commands with --help do NOT touch the filesystem', () => {
  const { fakeHome, env } = isolatedEnv();
  try {
    // Snapshot the fake HOME before each --help. If the command actually
    // ran, .construct/ or .construct/ would appear.
    for (const name of DESTRUCTIVE) {
      const before = fs.readdirSync(fakeHome).sort().join(',');
      const result = spawnSync(BIN, [name, '--help'], { env, encoding: 'utf8', timeout: 5000 });
      assert.equal(result.status, 0);
      const after = fs.readdirSync(fakeHome).sort().join(',');
      assert.equal(
        after,
        before,
        `construct ${name} --help should not write to HOME; before=[${before}] after=[${after}]`,
      );
    }
  } finally {
    rmTmpDir(fakeHome);
  }
});

test('top-level --all lists more commands than default --help', () => {
  const { fakeHome, env } = isolatedEnv();
  try {
    const defaultHelp = spawnSync(BIN, ['--help'], { env, encoding: 'utf8' });
    const allHelp = spawnSync(BIN, ['--all'], { env, encoding: 'utf8' });
    assert.equal(defaultHelp.status, 0);
    assert.equal(allHelp.status, 0);
    const defaultLines = defaultHelp.stdout.split('\n').length;
    const allLines = allHelp.stdout.split('\n').length;
    assert.ok(
      allLines > defaultLines,
      `--all should show more lines than default help (default=${defaultLines}, all=${allLines})`,
    );
    assert.ok(allHelp.stdout.includes('all commands'));
  } finally {
    rmTmpDir(fakeHome);
  }
});
