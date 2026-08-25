/**
 * tests/cli/doctor-daemon.test.ts — doctor's daemon check across its three
 * states: absent (the designed state), a live daemon reachable on its socket,
 * and a stale socket left behind by a daemon that died without cleaning up
 * (SIGKILL, the same way tests/cli/daemon.test.ts produces one). All three
 * report `ok`: the check exists to say what state the machine is in, not to
 * fail an install for a residency the design leaves opt-in.
 *
 * The daemon it talks to is a real subprocess, bound under a tmpdir HOME —
 * doctor resolves its own socket path from the same XDG env this file
 * mutates directly, exactly like the other doctor tests' `withIsolatedDirs`,
 * so the in-process doctor() call and the spawned daemon agree on where the
 * socket lives.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { doctor } from '../../src/cli/index.ts';
import { resolvePaths } from '../../src/kernel/paths.ts';

const LAUNCHER = fileURLToPath(new URL('../../bin/construct.mjs', import.meta.url));

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

function mkFixtureDir(): string {
  // A short prefix, deliberately: the daemon binds a unix socket under this
  // directory, and macOS's sockaddr_un has a ~104-byte path ceiling — a
  // descriptive-but-long tmpdir prefix is exactly how that ceiling gets hit
  // in CI even though the same fixture works fine on a shorter $TMPDIR.
  return mkdtempSync(join(tmpdir(), 'cx-doc-dmn-'));
}

/** Mirrors tests/cli/doctor.test.ts's own isolation: doctor resolves `paths`
 * from real process.env, not from the `env` object handed to it, so the
 * fixture has to mutate process.env directly. */
async function withIsolatedDirs<T>(root: string, fn: () => Promise<T>): Promise<T> {
  const previousData = process.env.XDG_DATA_HOME;
  const previousState = process.env.XDG_STATE_HOME;
  process.env.XDG_DATA_HOME = join(root, 'data');
  process.env.XDG_STATE_HOME = join(root, 'state');
  try {
    return await fn();
  } finally {
    if (previousData === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previousData;
    if (previousState === undefined) delete process.env.XDG_STATE_HOME;
    else process.env.XDG_STATE_HOME = previousState;
  }
}

function daemonEnv(root: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    HOME: root,
    XDG_STATE_HOME: join(root, 'state'),
    XDG_DATA_HOME: join(root, 'data'),
    XDG_CONFIG_HOME: join(root, 'config'),
    XDG_CACHE_HOME: join(root, 'cache'),
  };
}

interface Capture {
  readonly code: number;
  readonly out: string;
  readonly err: string;
}

function daemonCmd(root: string, ...argv: string[]): Capture {
  const result = spawnSync(process.execPath, [LAUNCHER, 'daemon', ...argv], {
    cwd: root,
    env: daemonEnv(root),
    encoding: 'utf8',
    timeout: 60_000,
  });
  return { code: result.status ?? -1, out: result.stdout ?? '', err: result.stderr ?? '' };
}

function recordedPid(root: string): number {
  const paths = resolvePaths(daemonEnv(root), root);
  const pid = Number(readFileSync(join(paths.stateDir, 'daemon.pid'), 'utf8').trim());
  raised.add(pid);
  return pid;
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

async function captureDoctorOut(root: string): Promise<string> {
  const realOut = process.stdout.write.bind(process.stdout);
  let out = '';
  process.stdout.write = ((chunk: string) => {
    out += chunk;
    return true;
  }) as typeof process.stdout.write;
  try {
    await doctor(root);
  } finally {
    process.stdout.write = realOut;
  }
  return out;
}

test('doctor names an absent daemon as the designed state, and stays ok', async () => {
  const root = mkFixtureDir();
  try {
    const out = await withIsolatedDirs(root, () => captureDoctorOut(root));
    assert.match(out, /ok {3}daemon {2}not running \(designed state\) — start one with: construct daemon start/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('doctor names a live daemon with its version and served store, and stays ok', async () => {
  const root = mkFixtureDir();
  try {
    const started = daemonCmd(root, 'start', '--idle-exit=120', '--every=3600');
    assert.strictEqual(started.code, 0, started.err);
    const pid = recordedPid(root);
    try {
      const out = await withIsolatedDirs(root, () => captureDoctorOut(root));
      assert.match(out, /ok {3}daemon {2}running \(version [^)]+\), serving .*construct\.db/);
    } finally {
      daemonCmd(root, 'stop');
      await until(() => !alive(pid));
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('doctor names a stale socket and the fix, and still stays ok', async () => {
  const root = mkFixtureDir();
  try {
    const started = daemonCmd(root, 'start', '--idle-exit=120', '--every=3600');
    assert.strictEqual(started.code, 0, started.err);
    const pid = recordedPid(root);

    // No handler runs on SIGKILL, which is the point: the socket file
    // outlives the process that bound it.
    process.kill(pid, 'SIGKILL');
    assert.ok(await until(() => !alive(pid)), 'the process is gone');

    const out = await withIsolatedDirs(root, () => captureDoctorOut(root));
    assert.match(
      out,
      /ok {3}daemon {2}STALE SOCKET at .*daemon\.sock — nothing answers on it — recover with: construct daemon start \(or run construct cleanup to reap it\)/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
