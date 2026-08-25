/**
 * tests/kernel/daemon/loop.test.ts — the protections the resident is allowed
 * to exist because of, each exercised rather than asserted.
 *
 * Every claim here is one the daemon's design rests on: a second instance
 * cannot bind, a socket left behind by a dead one does not block a live one,
 * a quiet daemon exits itself, a newer client retires an older daemon, a slow
 * sweep does not overlap itself, and shutdown removes the file that is the
 * daemon's identity. All of it runs in-process on tiny timers against a
 * tmpdir, so nothing here leaves a process behind to be reaped by hand.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createConnection } from 'node:net';
import { readFileSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { ftruncateSync, openSync, closeSync } from 'node:fs';
import { startDaemon } from '../../../src/kernel/daemon/loop.ts';
import type { DaemonConfig, DaemonHandle, SweepOutcome } from '../../../src/kernel/daemon/loop.ts';
import {
  daemonSocketPath,
  ensureStateDir,
  socketFileExists,
} from '../../../src/kernel/daemon/socket.ts';
import { LOG_ROTATE_BYTES, openDaemonLog } from '../../../src/kernel/daemon/log.ts';
import { encodeLine, LineReader, PROTOCOL } from '../../../src/kernel/daemon/protocol.ts';
import type { Reply } from '../../../src/kernel/daemon/protocol.ts';
import { sterile } from '../../harness/sterile.ts';

const QUIET: SweepOutcome = { foundWork: false, lines: [] };

interface Bench {
  readonly socket: string;
  readonly lines: string[];
  readonly cleanup: () => void;
  readonly config: (overrides?: Partial<DaemonConfig>) => DaemonConfig;
}

function bench(): Bench {
  const fixture = sterile();
  ensureStateDir(fixture.paths);
  const socket = daemonSocketPath(fixture.paths);
  const lines: string[] = [];
  return {
    socket,
    lines,
    cleanup: fixture.cleanup,
    config: (overrides = {}) => ({
      socketPath: socket,
      version: '1.0.0',
      idleExitSeconds: 100,
      sweepIntervalMs: 100_000,
      sweep: async () => QUIET,
      counts: () => ({ standingDue: 0, watchDue: 0 }),
      storePath: fixture.paths.dataDir,
      log: {
        write: (line) => {
          lines.push(line);
        },
        close: () => {},
      },
      ...overrides,
    }),
  };
}

/** One raw exchange, so a test can greet as any version it likes. */
async function exchange(
  socketPath: string,
  clientVersion: string,
  request: unknown,
): Promise<{ daemonVersion: string; reply: Reply }> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath);
    const reader = new LineReader();
    let daemonVersion: string | null = null;
    let reply: Reply | null = null;
    socket.setEncoding('utf8');
    socket.on('connect', () => {
      socket.write(encodeLine({ v: clientVersion, proto: PROTOCOL }));
      socket.write(encodeLine(request));
    });
    socket.on('data', (chunk: string) => {
      for (const line of reader.push(chunk)) {
        if (daemonVersion === null) daemonVersion = (JSON.parse(line) as { v: string }).v;
        else reply = JSON.parse(line) as Reply;
      }
    });
    socket.on('error', reject);
    socket.on('close', () => {
      if (daemonVersion === null || reply === null) reject(new Error('no answer'));
      else resolve({ daemonVersion, reply });
    });
  });
}

async function stopped(handle: DaemonHandle): Promise<void> {
  handle.stop('client');
  await handle.stopped;
}

test('a second daemon cannot bind the socket a live one owns', async () => {
  const b = bench();
  try {
    const first = await startDaemon(b.config());
    assert.ok(first, 'the first daemon binds');
    assert.ok(socketFileExists(b.socket), 'the socket file is on disk');
    assert.strictEqual(statSync(b.socket).mode & 0o777, 0o600, 'the socket is private to its owner');

    const second = await startDaemon(b.config());
    assert.strictEqual(second, null, 'a second start finds the live owner and stands down');

    await stopped(first);
    assert.ok(!socketFileExists(b.socket), 'shutdown removes the socket file');
  } finally {
    b.cleanup();
  }
});

test('a socket file with nobody behind it is unlinked and rebound', async () => {
  const b = bench();
  try {
    // What a killed daemon leaves: the path is occupied, and nothing answers.
    writeFileSync(b.socket, '');
    assert.ok(socketFileExists(b.socket), 'the stale file is in the way');

    const daemon = await startDaemon(b.config());
    assert.ok(daemon, 'a stale socket does not stop a fresh daemon');
    await stopped(daemon);
  } finally {
    b.cleanup();
  }
});

test('the socket binds under the injected state directory, never a real home', async () => {
  const fixture = sterile();
  try {
    ensureStateDir(fixture.paths);
    assert.ok(
      daemonSocketPath(fixture.paths).startsWith(fixture.root),
      'the daemon is keyed to the injected paths',
    );
  } finally {
    fixture.cleanup();
  }
});

test('a daemon nobody talks to exits itself after the quiet period', async () => {
  const b = bench();
  try {
    const daemon = await startDaemon(b.config({ idleExitSeconds: 0.2 }));
    assert.ok(daemon);
    const reason = await daemon.stopped;
    assert.strictEqual(reason, 'idle', 'the idle clock is the orphan backstop');
    assert.ok(!socketFileExists(b.socket), 'and it takes its socket with it');
  } finally {
    b.cleanup();
  }
});

test('a daemon with the idle clock off outlives a quiet period and keeps sweeping', async () => {
  const b = bench();
  try {
    let sweeps = 0;
    const daemon = await startDaemon(
      b.config({
        // A quiet period this short would reap a daemon several times over
        // before this test finished, if the clock were armed at all.
        idleExitSeconds: null,
        sweepIntervalMs: 40,
        sweep: async () => {
          sweeps += 1;
          return QUIET;
        },
      }),
    );
    assert.ok(daemon);
    let exited = false;
    void daemon.stopped.then(() => {
      exited = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 600));
    assert.ok(!exited, 'nothing reaped it: the supervisor owns that');
    assert.ok(socketFileExists(b.socket), 'and it still owns its socket');
    const swept = sweeps;
    assert.ok(swept >= 3, `it kept sweeping through the quiet window (${String(swept)})`);
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.ok(sweeps > swept, 'and it is still sweeping');
    await stopped(daemon);
  } finally {
    b.cleanup();
  }
});

test('two starts racing one stale socket leave exactly one daemon', async () => {
  const b = bench();
  try {
    // What a killed daemon leaves: both starts find the path occupied, both
    // find nothing answering, and only one of them may unlink and rebind.
    writeFileSync(b.socket, '');
    const [first, second] = await Promise.all([
      startDaemon(b.config()),
      startDaemon(b.config()),
    ]);
    const raised = [first, second].filter((handle) => handle !== null);
    assert.strictEqual(raised.length, 1, 'one bound, and the loser stood down rather than binding too');
    assert.ok(socketFileExists(b.socket), 'and the winner owns the socket');
    await stopped(raised[0]);
    assert.ok(!socketFileExists(b.socket), 'which it takes with it, leaving nothing behind');
  } finally {
    b.cleanup();
  }
});

test('a turn to bind abandoned mid-flight does not lock the socket out forever', async () => {
  const b = bench();
  try {
    // A start that died between taking the turn and binding. The next start
    // reclaims the turn rather than waiting on a process that is gone.
    writeFileSync(`${b.socket}.binding`, '');
    const then = Date.now() / 1000 - 3600;
    utimesSync(`${b.socket}.binding`, then, then);
    const daemon = await startDaemon(b.config());
    assert.ok(daemon, 'the abandoned turn was reclaimed');
    await stopped(daemon);
    assert.ok(!socketFileExists(`${b.socket}.binding`), 'and the turn was handed back');
  } finally {
    b.cleanup();
  }
});

test('a sweep that found work resets the quiet period', async () => {
  const b = bench();
  try {
    let sweeps = 0;
    const daemon = await startDaemon(
      b.config({
        idleExitSeconds: 0.4,
        sweepIntervalMs: 100,
        sweep: async () => {
          sweeps += 1;
          return { foundWork: sweeps < 4, lines: [`sweep ${String(sweeps)}`] };
        },
      }),
    );
    assert.ok(daemon);
    await daemon.stopped;
    assert.ok(sweeps >= 4, `work kept it alive past the quiet period (${String(sweeps)} sweeps)`);
  } finally {
    b.cleanup();
  }
});

test('a newer client retires an older daemon after its request is answered', async () => {
  const b = bench();
  try {
    const daemon = await startDaemon(b.config({ version: '1.0.0' }));
    assert.ok(daemon);
    const { daemonVersion, reply } = await exchange(b.socket, '2.0.0', { cmd: 'status' });
    assert.strictEqual(daemonVersion, '1.0.0', 'the daemon greets with its own version');
    assert.ok(reply.ok, 'the request is finished before anything else happens');

    const reason = await daemon.stopped;
    assert.strictEqual(reason, 'stale-version', 'then the stale daemon exits itself');
    assert.ok(!socketFileExists(b.socket), 'so the next start binds a fresh one');
  } finally {
    b.cleanup();
  }
});

test('a same-version client is served and the daemon stays up', async () => {
  const b = bench();
  try {
    const daemon = await startDaemon(b.config({ version: '1.0.0' }));
    assert.ok(daemon);
    const { reply } = await exchange(b.socket, '1.0.0', { cmd: 'status' });
    assert.ok(reply.ok && 'uptimeSeconds' in reply, 'status answers with the daemon it reached');
    assert.ok(socketFileExists(b.socket), 'and the daemon is still there');
    await stopped(daemon);
  } finally {
    b.cleanup();
  }
});

test('a stop request stops it', async () => {
  const b = bench();
  try {
    const daemon = await startDaemon(b.config());
    assert.ok(daemon);
    const { reply } = await exchange(b.socket, '1.0.0', { cmd: 'stop' });
    assert.ok(reply.ok, 'the stop is acknowledged before the socket goes');
    const reason = await daemon.stopped;
    assert.strictEqual(reason, 'client');
  } finally {
    b.cleanup();
  }
});

test('a tick that lands on a running sweep is skipped, never queued', async () => {
  const b = bench();
  try {
    let entered = 0;
    let concurrent = 0;
    let peak = 0;
    const daemon = await startDaemon(
      b.config({
        sweepIntervalMs: 40,
        sweep: async () => {
          entered += 1;
          concurrent += 1;
          peak = Math.max(peak, concurrent);
          await new Promise((resolve) => setTimeout(resolve, 200));
          concurrent -= 1;
          return QUIET;
        },
      }),
    );
    assert.ok(daemon);
    await new Promise((resolve) => setTimeout(resolve, 600));
    await stopped(daemon);
    assert.ok(entered >= 2, `the sweep ran more than once (${String(entered)})`);
    assert.strictEqual(peak, 1, 'and never twice at the same time');
    assert.ok(
      b.lines.some((line) => line.includes('sweep skipped')),
      'and the ticks that landed on it said so',
    );
  } finally {
    b.cleanup();
  }
});

test('a sweep that blocks the event loop is reported, and nothing else happens', async () => {
  const b = bench();
  try {
    let blocked = false;
    const daemon = await startDaemon(
      b.config({
        sweepIntervalMs: 60,
        sweep: async () => {
          if (!blocked) {
            blocked = true;
            // Synchronous on purpose: this is what a resident must never do,
            // and the daemon's only job is to say so.
            const until = Date.now() + 1200;
            while (Date.now() < until) {
              /* hold the loop */
            }
          }
          return { foundWork: false, lines: ['swept'] };
        },
      }),
    );
    assert.ok(daemon);
    await new Promise((resolve) => setTimeout(resolve, 1800));
    const duringTheRun = [...b.lines];
    await stopped(daemon);
    assert.ok(
      duringTheRun.some((line) => /event loop p99 \d+ms exceeds 1000ms/.test(line)),
      `the delay is logged: ${duringTheRun.join(' | ')}`,
    );
    assert.ok(
      duringTheRun.filter((line) => line === 'swept').length > 1,
      'and only logged: the daemon kept sweeping rather than acting on it',
    );
  } finally {
    b.cleanup();
  }
});

test('an oversized log is rolled aside once at open', () => {
  const fixture = sterile();
  try {
    ensureStateDir(fixture.paths);
    const logPath = `${fixture.paths.stateDir}/daemon.log`;
    const fd = openSync(logPath, 'w');
    ftruncateSync(fd, LOG_ROTATE_BYTES + 1);
    closeSync(fd);

    const log = openDaemonLog(logPath);
    log.write('fresh');
    log.close();

    assert.ok(statSync(`${logPath}.1`).size > LOG_ROTATE_BYTES, 'the old log is kept as .1');
    const current = readFileSync(logPath, 'utf8');
    assert.match(current, /fresh\n$/, 'and the new one starts empty');
    assert.match(current, /^\d{4}-\d{2}-\d{2}T/, 'every line is timestamped');
  } finally {
    fixture.cleanup();
  }
});

test('a state dir past the sun_path budget gets a digest-keyed socket in tmp, same for every client', () => {
  const deep = '/tmp/' + 'x'.repeat(120);
  const paths = { configDir: deep, stateDir: deep, dataDir: deep, cacheDir: deep };
  const a = daemonSocketPath(paths, '/tmp/shortbase');
  const b = daemonSocketPath(paths, '/tmp/shortbase');
  assert.equal(a, b);
  assert.ok(a.startsWith('/tmp/shortbase/construct-daemon-'), a);
  assert.ok(Buffer.byteLength(a, 'utf8') <= 100, a);
  const other = daemonSocketPath({ ...paths, stateDir: deep + 'y' }, '/tmp/shortbase');
  assert.notEqual(a, other);
});
