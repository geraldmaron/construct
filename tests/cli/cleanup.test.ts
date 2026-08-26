/**
 * tests/cli/cleanup.test.ts — CLI-surface coverage for `construct cleanup`:
 * arg parsing, dry-run non-mutation, and the exit codes around --yes.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseCleanupArgs, cleanup } from '../../src/cli/index.ts';
import type { SpawnFn } from '../../src/kernel/cleanup/catalog.ts';
import { resolvePaths } from '../../src/kernel/paths.ts';
import { daemonSocketPath } from '../../src/kernel/daemon/socket.ts';
import { AMBIENT_ENV_KEYS } from '../../src/hosts/ambient.ts';

const LAUNCHER = fileURLToPath(new URL('../../bin/construct.mjs', import.meta.url));

// Keeps these tests from depending on whatever docker/launchctl state
// happens to be real on the machine running them.
const NOT_FOUND_SPAWN: SpawnFn = () => ({ status: 1, stdout: '', stderr: '' });

async function captureStdio<T>(fn: () => T | Promise<T>): Promise<{ result: T; out: string; err: string }> {
  const realOut = process.stdout.write.bind(process.stdout);
  const realErr = process.stderr.write.bind(process.stderr);
  let out = '';
  let err = '';
  process.stdout.write = ((chunk: string) => {
    out += chunk;
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string) => {
    err += chunk;
    return true;
  }) as typeof process.stderr.write;
  try {
    const result = await fn();
    return { result, out, err };
  } finally {
    process.stdout.write = realOut;
    process.stderr.write = realErr;
  }
}

test('parseCleanupArgs defaults to no flags set', () => {
  const args = parseCleanupArgs([]);
  assert.equal(args.dryRun, false);
  assert.equal(args.yes, false);
  assert.equal(args.all, false);
  assert.equal(args.keepState, false);
  assert.equal(args.withImages, false);
  assert.equal(args.scope, 'all');
});

test('parseCleanupArgs parses every flag', () => {
  const args = parseCleanupArgs([
    '--dry-run',
    '--yes',
    '--all',
    '--keep-state',
    '--with-images',
    '--scope=project',
    '--cwd=/tmp/p',
    '--home=/tmp/h',
  ]);
  assert.equal(args.dryRun, true);
  assert.equal(args.yes, true);
  assert.equal(args.all, true);
  assert.equal(args.keepState, true);
  assert.equal(args.withImages, true);
  assert.equal(args.scope, 'project');
  assert.equal(args.cwd, '/tmp/p');
  assert.equal(args.home, '/tmp/h');
});

test('parseCleanupArgs rejects an invalid scope', () => {
  assert.throws(() => parseCleanupArgs(['--scope=nope']), /Invalid --scope/);
});

test('--dry-run changes nothing on disk', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-cli-cleanup-proj-'));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-cli-cleanup-home-'));
  try {
    fs.mkdirSync(path.join(cwd, '.construct', 'launcher'), { recursive: true });
    const { result, out } = await captureStdio(() => cleanup(['--dry-run', `--cwd=${cwd}`, `--home=${home}`], NOT_FOUND_SPAWN));
    assert.equal(result, 0);
    assert.match(out, /dry-run plan/);
    assert.ok(fs.existsSync(path.join(cwd, '.construct', 'launcher')), 'nothing removed');
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('bare invocation (no --dry-run or --yes) refuses to guess and exits non-zero', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-cli-cleanup-proj-'));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-cli-cleanup-home-'));
  try {
    fs.mkdirSync(path.join(cwd, '.construct', 'launcher'), { recursive: true });
    const { result, err } = await captureStdio(() => cleanup([`--cwd=${cwd}`, `--home=${home}`], NOT_FOUND_SPAWN));
    assert.equal(result, 2);
    assert.match(err, /--dry-run|--yes/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('--yes applies auto-risk removals and reports a summary', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-cli-cleanup-proj-'));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-cli-cleanup-home-'));
  try {
    fs.mkdirSync(path.join(cwd, '.construct', 'launcher'), { recursive: true });
    const { result, out } = await captureStdio(() => cleanup(['--yes', `--cwd=${cwd}`, `--home=${home}`], NOT_FOUND_SPAWN));
    assert.equal(result, 0);
    // "kept" is deliberately its own count: an item the successor owns
    // ran and removed nothing, and folding it into "removed" would report a
    // deletion that did not happen.
    assert.match(out, /removed 1, kept \d+, skipped \d+\./);
    assert.equal(fs.existsSync(path.join(cwd, '.construct', 'launcher')), false);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('reports cleanly when nothing is detected', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-cli-cleanup-proj-'));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-cli-cleanup-home-'));
  try {
    const { result, out } = await captureStdio(() => cleanup(['--yes', `--cwd=${cwd}`, `--home=${home}`], NOT_FOUND_SPAWN));
    assert.equal(result, 0);
    assert.match(out, /no predecessor state detected/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// a live daemon's residue survives `cleanup --yes --all`
// ---------------------------------------------------------------------------

/** Everything this file spawned, so teardown can be sure of it. */
const raised = new Set<number>();

after(() => {
  for (const pid of raised) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // Already gone, which is the expected case.
    }
  }
});

test("cleanup --yes --all does not delete a live daemon's socket", async () => {
  // A short prefix, deliberately: the daemon binds a unix socket under this
  // directory, and macOS's sockaddr_un has a ~104-byte path ceiling — a
  // descriptive-but-long tmpdir prefix is exactly how that ceiling gets hit
  // in CI even though the same fixture works fine on a shorter $TMPDIR.
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-cli-dmn-'));
  const previousState = process.env.XDG_STATE_HOME;
  const previousData = process.env.XDG_DATA_HOME;
  process.env.XDG_STATE_HOME = path.join(home, 'state');
  process.env.XDG_DATA_HOME = path.join(home, 'data');
  try {
    const daemonEnv: NodeJS.ProcessEnv = { ...process.env, HOME: home, NODE_NO_WARNINGS: '1' };
    for (const key of AMBIENT_ENV_KEYS) delete daemonEnv[key];
    const started = spawnSync(process.execPath, [LAUNCHER, 'daemon', 'start', '--idle-exit=120', '--every=3600'], {
      cwd: home,
      env: daemonEnv,
      encoding: 'utf8',
      timeout: 60_000,
    });
    assert.strictEqual(started.status, 0, started.stderr ?? '');
    const paths = resolvePaths(daemonEnv, home);
    const pid = Number(fs.readFileSync(path.join(paths.stateDir, 'daemon.pid'), 'utf8').trim());
    raised.add(pid);
    try {
      const { result } = await captureStdio(() =>
        cleanup(['--yes', '--all', `--cwd=${home}`, `--home=${home}`], NOT_FOUND_SPAWN),
      );
      assert.equal(result, 0);
      assert.ok(fs.existsSync(daemonSocketPath(paths)), "the live daemon's socket survives cleanup");
    } finally {
      spawnSync(process.execPath, [LAUNCHER, 'daemon', 'stop'], {
        cwd: home,
        env: daemonEnv,
        encoding: 'utf8',
        timeout: 60_000,
      });
    }
  } finally {
    if (previousState === undefined) delete process.env.XDG_STATE_HOME;
    else process.env.XDG_STATE_HOME = previousState;
    if (previousData === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previousData;
    fs.rmSync(home, { recursive: true, force: true });
  }
});
