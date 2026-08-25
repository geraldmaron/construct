/**
 * tests/kernel/cleanup/daemon.test.ts — the daemon's own residue in the
 * cleanup catalog: a stale socket is listed and reaped, a live daemon's
 * socket (and its log and advisory pid file) are never offered, and the
 * pre-existing `machine-state` item — which used to remove the whole state
 * directory wholesale — now keeps it rather than deleting a live socket out
 * from under a running daemon.
 *
 * The "stale" fixture is a real subprocess daemon killed with SIGKILL, the
 * same technique tests/cli/daemon.test.ts uses to produce one: nothing here
 * hand-crafts unix-socket bytes, because the only fact that matters is what a
 * real dead daemon actually leaves behind.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolvePaths } from '../../../src/kernel/paths.ts';
import { buildCleanupCatalog } from '../../../src/kernel/cleanup/catalog.ts';
import type { SpawnFn } from '../../../src/kernel/cleanup/catalog.ts';
import { detectedItems } from '../../../src/kernel/cleanup/run.ts';
import { daemonLogPath, daemonPidPath, daemonSocketPath, socketFileExists } from '../../../src/kernel/daemon/socket.ts';

const LAUNCHER = fileURLToPath(new URL('../../../bin/construct.mjs', import.meta.url));
const NOT_FOUND_SPAWN: SpawnFn = () => ({ status: 1, stdout: '', stderr: '' });

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

function mkHome(): string {
  // A short prefix, deliberately: the daemon binds a unix socket under this
  // directory, and macOS's sockaddr_un has a ~104-byte path ceiling — a
  // descriptive-but-long tmpdir prefix is exactly how that ceiling gets hit
  // in CI even though the same fixture works fine on a shorter $TMPDIR.
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cx-cln-dmn-'));
}

function daemonEnv(home: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    HOME: home,
    XDG_STATE_HOME: path.join(home, 'state'),
    XDG_DATA_HOME: path.join(home, 'data'),
    XDG_CONFIG_HOME: path.join(home, 'config'),
    XDG_CACHE_HOME: path.join(home, 'cache'),
  };
}

function daemonCmd(home: string, ...argv: string[]): { code: number; out: string; err: string } {
  const result = spawnSync(process.execPath, [LAUNCHER, 'daemon', ...argv], {
    cwd: home,
    env: daemonEnv(home),
    encoding: 'utf8',
    timeout: 60_000,
  });
  return { code: result.status ?? -1, out: result.stdout ?? '', err: result.stderr ?? '' };
}

async function until(predicate: () => boolean, ms = 20_000): Promise<boolean> {
  const deadline = Date.now() + ms;
  for (;;) {
    if (predicate()) return true;
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

test('a live daemon\'s socket is never offered, and machine-state keeps the whole directory', async () => {
  const home = mkHome();
  try {
    const paths = resolvePaths(daemonEnv(home), home);
    const started = daemonCmd(home, 'start', '--idle-exit=120', '--every=3600');
    assert.strictEqual(started.code, 0, started.err);
    const pid = Number(fs.readFileSync(daemonPidPath(paths), 'utf8').trim());
    raised.add(pid);
    try {
      const catalog = buildCleanupCatalog({
        cwd: home,
        home,
        paths,
        spawn: NOT_FOUND_SPAWN,
        daemonLive: true,
      });
      const detected = detectedItems(catalog, { scope: 'machine', all: true, keepState: false });

      assert.equal(
        detected.some((item) => item.id === 'machine-daemon-socket'),
        false,
        'a live socket is never offered for cleanup',
      );

      const machineState = detected.find((item) => item.id === 'machine-state');
      assert.ok(machineState, 'machine-state is still detected (the directory exists)');
      assert.ok(machineState.keeps?.(), 'but it is kept — a live daemon owns the directory');
      assert.match(machineState.remove(), /kept — a live daemon owns this directory/);
      assert.ok(socketFileExists(daemonSocketPath(paths)), 'the live socket survived the remove() call');
    } finally {
      daemonCmd(home, 'stop');
      await until(() => !alive(pid));
    }
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('a stale socket left by a killed daemon is listed and reaped', async () => {
  const home = mkHome();
  try {
    const paths = resolvePaths(daemonEnv(home), home);
    const started = daemonCmd(home, 'start', '--idle-exit=120', '--every=3600');
    assert.strictEqual(started.code, 0, started.err);
    const pid = Number(fs.readFileSync(daemonPidPath(paths), 'utf8').trim());
    raised.add(pid);

    // No handler runs on SIGKILL, which is the point: the socket file
    // outlives the process that bound it.
    process.kill(pid, 'SIGKILL');
    assert.ok(await until(() => !alive(pid)), 'the process is gone');
    assert.ok(socketFileExists(daemonSocketPath(paths)), 'and its socket file is not');

    const catalog = buildCleanupCatalog({
      cwd: home,
      home,
      paths,
      spawn: NOT_FOUND_SPAWN,
      daemonLive: false,
    });
    const detected = detectedItems(catalog, { scope: 'machine', all: true, keepState: false });
    const item = detected.find((entry) => entry.id === 'machine-daemon-socket');
    assert.ok(item, 'the stale socket is listed');

    const detail = item.remove();
    assert.match(detail, /removed \(stale socket reaped\)/);
    assert.equal(socketFileExists(daemonSocketPath(paths)), false, 'unlinked');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('the daemon log, rotated log, and advisory pid file are listed for a not-live daemon', () => {
  const home = mkHome();
  try {
    const paths = resolvePaths({}, home);
    fs.mkdirSync(paths.stateDir, { recursive: true });
    fs.writeFileSync(daemonLogPath(paths), 'a log line\n');
    fs.writeFileSync(`${daemonLogPath(paths)}.1`, 'a rotated log line\n');
    fs.writeFileSync(daemonPidPath(paths), '99999\n');

    const catalog = buildCleanupCatalog({ cwd: home, home, paths, spawn: NOT_FOUND_SPAWN, daemonLive: false });
    const detected = detectedItems(catalog, { scope: 'machine', all: true, keepState: false });

    const log = detected.find((item) => item.id === 'machine-daemon-log');
    assert.ok(log, 'the log(s) are listed');
    assert.match(log.remove(), /removed/);
    assert.equal(fs.existsSync(daemonLogPath(paths)), false);
    assert.equal(fs.existsSync(`${daemonLogPath(paths)}.1`), false);

    const pidItem = detected.find((item) => item.id === 'machine-daemon-pid');
    assert.ok(pidItem, 'the advisory pid file is listed');
    assert.equal(pidItem.remove(), 'removed');
    assert.equal(fs.existsSync(daemonPidPath(paths)), false);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('a live daemon\'s log and advisory pid file are not offered either', () => {
  const home = mkHome();
  try {
    const paths = resolvePaths({}, home);
    fs.mkdirSync(paths.stateDir, { recursive: true });
    fs.writeFileSync(daemonLogPath(paths), 'a log line\n');
    fs.writeFileSync(daemonPidPath(paths), '99999\n');

    const catalog = buildCleanupCatalog({ cwd: home, home, paths, spawn: NOT_FOUND_SPAWN, daemonLive: true });
    const detected = detectedItems(catalog, { scope: 'machine', all: true, keepState: false });

    assert.equal(detected.some((item) => item.id === 'machine-daemon-log'), false);
    assert.equal(detected.some((item) => item.id === 'machine-daemon-pid'), false);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
