/**
 * tests/cli/daemon.test.ts — the resident through the verbs a person types,
 * including the two ways it dies badly.
 *
 * Every invocation here goes through the real launcher as a subprocess, and
 * the daemon it raises is a real detached process, because the failures worth
 * covering are exactly the ones an in-process handle cannot have: a SIGTERM
 * that has to leave no socket behind, and a SIGKILL that leaves one behind on
 * purpose so the next start has something stale to clear.
 *
 * Everything this file raises is killed in its own teardown, and everything it
 * writes lands under a tmpdir HOME — the daemon resolves its socket from the
 * state directory, so redirecting the environment redirects the daemon.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolvePaths } from '../../src/kernel/paths.ts';
import { daemonSocketPath, socketFileExists } from '../../src/kernel/daemon/socket.ts';

const LAUNCHER = fileURLToPath(new URL('../../bin/construct.mjs', import.meta.url));
const root = mkdtempSync(join(tmpdir(), 'construct-daemon-'));
const env = {
  ...process.env,
  HOME: root,
  XDG_STATE_HOME: join(root, 'state'),
  XDG_DATA_HOME: join(root, 'data'),
  XDG_CONFIG_HOME: join(root, 'config'),
  XDG_CACHE_HOME: join(root, 'cache'),
};
const paths = resolvePaths(env, root);
const socket = daemonSocketPath(paths);

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
  rmSync(root, { recursive: true, force: true });
});

interface Capture {
  readonly code: number;
  readonly out: string;
  readonly err: string;
}

function run(...argv: string[]): Capture {
  const result = spawnSync(process.execPath, [LAUNCHER, 'daemon', ...argv], {
    // The sandbox is the working directory too: a verb that resolves a store
    // from the cwd must not find this repository's.
    cwd: root,
    env,
    encoding: 'utf8',
    timeout: 60_000,
  });
  return { code: result.status ?? -1, out: result.stdout ?? '', err: result.stderr ?? '' };
}

/** The pid the last start recorded. Advisory metadata, and a test's handle. */
function recordedPid(): number {
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

test('status on a machine with no daemon says so and exits 0', () => {
  const result = run('status');
  assert.strictEqual(result.code, 0, 'nothing running is the designed state, not a failure');
  assert.match(result.out, /not running \(designed state\)/);
});

test('stop with nothing running is already stopped, and exits 0', () => {
  const result = run('stop');
  assert.strictEqual(result.code, 0);
  assert.match(result.out, /already stopped/);
});

test('the socket is bound under the state directory, not the working directory', async () => {
  const started = run('start', '--idle-exit=120', '--every=3600');
  assert.strictEqual(started.code, 0, started.err);
  const pid = recordedPid();
  assert.ok(socket.startsWith(paths.stateDir), 'the path is keyed to the state directory');
  assert.ok(socket.startsWith(root), 'and the state directory is the harness tmpdir, not a real home');
  assert.ok(socketFileExists(socket), 'and that is where it bound');
  assert.ok(started.out.includes(`started on ${socket}`), 'which is what it reports');
  run('stop');
  assert.ok(await until(() => !alive(pid)));
});

test('a second start is idempotent and raises nothing', async () => {
  const first = run('start', '--idle-exit=120', '--every=3600');
  assert.strictEqual(first.code, 0, first.err);
  const pid = recordedPid();

  const status = run('status');
  assert.strictEqual(status.code, 0);
  assert.match(status.out, /^running \(version /);
  assert.match(status.out, /due: \d+ standing, \d+ watch/, 'status carries the cheap due counts');

  const second = run('start');
  assert.strictEqual(second.code, 0, 'a second start reports and stands down');
  assert.match(second.out, /already running/);
  assert.strictEqual(recordedPid(), pid, 'and the pid on record is unchanged');

  const stop = run('stop');
  assert.strictEqual(stop.code, 0, stop.err);
  assert.match(stop.out, /^stopped/);
  assert.ok(await until(() => !alive(pid)), 'the process is gone');
  assert.ok(!socketFileExists(socket), 'and so is the socket');
});

test('SIGTERM leaves no socket behind', async () => {
  const started = run('start', '--idle-exit=120', '--every=3600');
  assert.strictEqual(started.code, 0, started.err);
  const pid = recordedPid();

  process.kill(pid, 'SIGTERM');
  assert.ok(await until(() => !alive(pid)), 'it stops on the supervisor signal');
  assert.ok(await until(() => !socketFileExists(socket)), 'and removes its own identity on the way out');
});

test('a killed daemon leaves a stale socket, and the next start clears it', async () => {
  const started = run('start', '--idle-exit=120', '--every=3600');
  assert.strictEqual(started.code, 0, started.err);
  const killed = recordedPid();

  // No handler runs on SIGKILL, which is the point: nothing tidies up.
  process.kill(killed, 'SIGKILL');
  assert.ok(await until(() => !alive(killed)), 'the process is gone');
  assert.ok(socketFileExists(socket), 'and its socket file is not');

  const restarted = run('start', '--idle-exit=120', '--every=3600');
  assert.strictEqual(restarted.code, 0, restarted.err);
  assert.match(restarted.out, /^started on /, 'a stale socket does not read as a live daemon');
  const fresh = recordedPid();
  assert.notStrictEqual(fresh, killed, 'the daemon answering now is the new one');

  const status = run('status');
  assert.match(status.out, /^running \(version /, 'exactly one daemon owns the socket');

  run('stop');
  assert.ok(await until(() => !alive(fresh)), 'and one stop is enough to end it');
});

test('run --foreground stays attached and exits itself when idle', () => {
  const before = Date.now();
  const result = run('run', '--foreground', '--idle-exit=0.3', '--every=3600');
  assert.strictEqual(result.code, 0, result.err);
  assert.ok(Date.now() - before < 30_000, 'the quiet period is what ended it');
  assert.match(result.err, /listening on /, 'a foreground run logs to the operator, not to a file');
  assert.match(result.err, /stopped \(idle\)/);
  assert.ok(!socketFileExists(socket), 'and it removed its socket');
});

test('an unknown subcommand prints the usage and fails closed', () => {
  const result = run('sweep-everything');
  assert.strictEqual(result.code, 2);
  assert.match(result.err, /usage: construct daemon start/);
});
