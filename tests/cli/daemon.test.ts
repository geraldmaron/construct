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
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolvePaths } from '../../src/kernel/paths.ts';
import { daemonSocketPath, socketFileExists } from '../../src/kernel/daemon/socket.ts';
import { daemonChildEnv, storeMismatchNotice } from '../../src/cli/daemon.ts';

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

test('a foreground run with the idle clock off outlives the quiet period and keeps sweeping', async () => {
  const child = spawn(
    process.execPath,
    [LAUNCHER, 'daemon', 'run', '--foreground', '--idle-exit=never', '--every=0.2'],
    { cwd: root, env, stdio: ['ignore', 'ignore', 'pipe'] },
  );
  raised.add(child.pid ?? 0);
  let log = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    log += chunk;
  });
  try {
    assert.ok(await until(() => log.includes('listening on ')), log);
    assert.match(log, /no idle exit: the supervisor owns this process/);
    // Long enough that a daemon holding even the shortest quiet period the
    // flag surface accepts would still be here; long enough that many sweeps
    // have fired. What is being watched for is an exit that must not come.
    await new Promise((resolve) => setTimeout(resolve, 2000));
    assert.strictEqual(child.exitCode, null, `it is still up: ${log}`);
    assert.ok(socketFileExists(socket), 'and still owns its socket');

    const status = run('status');
    assert.match(status.out, /never exits on idle/, status.out + status.err);
    assert.match(status.out, /sweeps: [1-9]/, 'and it has been sweeping all along');
  } finally {
    child.kill('SIGTERM');
    await until(() => child.exitCode !== null || child.signalCode !== null);
  }
});

test('a detached start refuses to turn its own idle clock off', () => {
  const result = run('start', '--idle-exit=never');
  assert.strictEqual(result.code, 2, 'nothing would ever reap it');
  assert.match(result.err, /keeps its idle clock/);
  assert.match(result.err, /schedule install --always-on/);
  assert.ok(!socketFileExists(socket), 'and nothing was raised');
});

/**
 * A daemon of some other version holding the socket, in its own process.
 *
 * Its own process and not this one: every verb below runs through spawnSync,
 * which blocks this process outright, so a daemon living here could never
 * answer the connection the verb makes.
 */
function raiseDaemonAtVersion(version: string): {
  readonly child: ReturnType<typeof spawn>;
  readonly output: () => string;
} {
  const src = fileURLToPath(new URL('../../src/', import.meta.url));
  const script =
    `const { startDaemon } = await import(${JSON.stringify(`${src}kernel/daemon/loop.ts`)});\n` +
    `const handle = await startDaemon({\n` +
    `  socketPath: ${JSON.stringify(socket)},\n` +
    `  version: ${JSON.stringify(version)},\n` +
    `  idleExitSeconds: 600,\n` +
    `  sweepIntervalMs: 3600000,\n` +
    `  sweep: async () => ({ foundWork: false, lines: [] }),\n` +
    `  counts: () => ({ standingDue: 0, watchDue: 0 }),\n` +
    `  storePath: ${JSON.stringify(join(paths.dataDir, 'construct.db'))},\n` +
    `  log: { write: () => {}, close: () => {} },\n` +
    `});\n` +
    `process.stdout.write('listening\\n');\n` +
    `process.stdout.write('stopped=' + (await handle.stopped) + '\\n');\n`;
  const child = spawn(process.execPath, ['--input-type=module', '--eval', script], {
    cwd: root,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  raised.add(child.pid ?? 0);
  let output = '';
  child.stdout?.setEncoding('utf8');
  child.stdout?.on('data', (chunk: string) => {
    output += chunk;
  });
  child.stderr?.setEncoding('utf8');
  child.stderr?.on('data', (chunk: string) => {
    output += chunk;
  });
  return { child, output: () => output };
}

test('a start against an older daemon retires it and raises the current build', async () => {
  // A build that replaced the binary under a running daemon: the older one
  // holds the socket, and a bare connect calls that "already running" forever.
  const old = raiseDaemonAtVersion('0.0.1');
  try {
    assert.ok(await until(() => old.output().includes('listening')), old.output());

    const started = run('start', '--idle-exit=120', '--every=3600');
    assert.strictEqual(started.code, 0, started.err);
    assert.match(started.out, /the daemon on this machine was 0\.0\.1/, started.out);
    assert.match(started.out, /retired itself/);
    assert.match(started.out, /^started on /m, 'and the current build is up in its place');
    assert.ok(
      await until(() => old.output().includes('stopped=stale-version')),
      `the older one exited on its own: ${old.output()}`,
    );

    const status = run('status');
    assert.match(status.out, /^running \(version /, 'and something is still serving the socket');
    assert.doesNotMatch(status.out, /version 0\.0\.1/, 'which is the current build, not the retired one');
  } finally {
    old.child.kill('SIGKILL');
    run('stop');
    await until(() => !socketFileExists(socket));
    rmSync(socket, { force: true });
  }
});

test('a daemon that greets and hangs up mid-retirement reads as not running, not as a failure', async () => {
  // Exactly what a client sees while an older daemon is retiring: the hello
  // lands, and the connection goes before a reply does.
  rmSync(socket, { force: true });
  const script =
    `const { createServer } = await import('node:net');\n` +
    `const server = createServer((connection) => {\n` +
    `  connection.write(JSON.stringify({ v: '0.0.1', proto: 1 }) + '\\n');\n` +
    `  connection.destroy();\n` +
    `});\n` +
    `server.listen(${JSON.stringify(socket)}, () => process.stdout.write('listening\\n'));\n`;
  const child = spawn(process.execPath, ['--input-type=module', '--eval', script], {
    cwd: root,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  raised.add(child.pid ?? 0);
  let output = '';
  child.stdout?.setEncoding('utf8');
  child.stdout?.on('data', (chunk: string) => {
    output += chunk;
  });
  try {
    assert.ok(await until(() => output.includes('listening')), output);
    const status = run('status');
    assert.strictEqual(status.code, 0, `a retirement in progress is not an error: ${status.err}`);
    assert.match(status.out, /not running \(designed state\)/);
    assert.strictEqual(status.err, '', 'and nothing is reported as broken');
  } finally {
    child.kill('SIGKILL');
    await until(() => child.exitCode !== null || child.signalCode !== null);
    rmSync(socket, { force: true });
  }
});

test('the detached daemon is given what it needs and nothing else', () => {
  const child = daemonChildEnv({
    PATH: '/usr/bin',
    HOME: '/home/somebody',
    XDG_STATE_HOME: '/home/somebody/.local/state',
    CONSTRUCT_STATE: 'local',
    ANTHROPIC_API_KEY: 'should-not-be-resident',
    CONSTRUCT_JIRA_API_TOKEN: 'also-not',
    AWS_SECRET_ACCESS_KEY: 'nor-this',
  });
  assert.strictEqual(child.PATH, '/usr/bin');
  assert.strictEqual(child.HOME, '/home/somebody');
  assert.strictEqual(child.XDG_STATE_HOME, '/home/somebody/.local/state');
  assert.strictEqual(child.CONSTRUCT_STATE, 'local', 'which store this project asked for still travels');
  assert.match(child.NODE_OPTIONS ?? '', /--max-old-space-size=256/);
  for (const secret of ['ANTHROPIC_API_KEY', 'CONSTRUCT_JIRA_API_TOKEN', 'AWS_SECRET_ACCESS_KEY']) {
    assert.strictEqual(child[secret], undefined, `${secret} is not resident`);
  }
});

test('a start against a daemon serving another store says so and raises nothing', () => {
  const notice = storeMismatchNotice('/home/somebody/.local/share/construct/construct.db', '/repo/.construct/construct.db');
  assert.ok(notice !== null);
  assert.match(notice, /serves \/home\/somebody\/\.local\/share\/construct\/construct\.db/);
  assert.match(notice, /this repository's store is \/repo\/\.construct\/construct\.db/);
  assert.strictEqual(
    storeMismatchNotice('/same/construct.db', '/same/construct.db'),
    null,
    'one store, one daemon, nothing to say',
  );
});

test('an unknown subcommand prints the usage and fails closed', () => {
  const result = run('sweep-everything');
  assert.strictEqual(result.code, 2);
  assert.match(result.err, /usage: construct daemon start/);
});
