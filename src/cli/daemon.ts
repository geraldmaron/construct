/**
 * cli/daemon.ts — the opt-in resident, and the only door it can be raised
 * through.
 *
 * The designed state is nothing running. What is offered here is a residency a
 * person asks for by name: `daemon start` is the one spawn path in the
 * codebase, and nothing in init, install, library code, or any other verb can
 * reach the loop. That is not a convention — it is the leak class this tool
 * inherited, where a daemon auto-started from library init deduped against an
 * isolated test HOME and left orphans behind, so the door is single and the
 * structural check that keeps it single is a test.
 *
 * What the resident does is deliberately the cheap half of scheduled
 * operation: it sweeps source watches, which spend nothing, and it re-files
 * standing outcomes that have come due, which is a store write. It does not
 * work those runs, because working them dispatches to a host, and a host needs
 * a credential — nothing long-lived here holds one. Filing is left where a
 * person can see it, and `construct work` spends.
 */

import { spawn } from 'node:child_process';
import { openSync, rmSync, writeFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { fileURLToPath } from 'node:url';
import { resolvePaths } from '../kernel/paths.ts';
import {
  DEFAULT_IDLE_EXIT_SECONDS,
  DEFAULT_SWEEP_INTERVAL_MS,
  IDLE_EXIT_FLOOR_SECONDS,
  installCrashHandlers,
  startDaemon,
} from '../kernel/daemon/loop.ts';
import type { DaemonCounts, SweepOutcome } from '../kernel/daemon/loop.ts';
import { openDaemonLog, stderrDaemonLog } from '../kernel/daemon/log.ts';
import {
  daemonIsLive,
  daemonLogPath,
  daemonPidPath,
  daemonSocketPath,
  ensureStateDir,
  socketFileExists,
} from '../kernel/daemon/socket.ts';
import {
  compareVersions,
  encodeLine,
  LineReader,
  parseHello,
  PROTOCOL,
} from '../kernel/daemon/protocol.ts';
import type { Hello, Reply, Request, StatusReply } from '../kernel/daemon/protocol.ts';
import { dueStanding } from '../kernel/store/standing.ts';
import { dueSourceWatches } from '../kernel/store/source-watches.ts';
import { resolveStoreLocation } from './local-state.ts';
import { fileDueStanding } from './standing.ts';
import { sweepDueSourceWatches } from './watch.ts';
import { now, packageVersion, withStore } from './runtime.ts';
import { splitFlags } from './flags.ts';

const DAEMON_USAGE =
  'usage: construct daemon start [--idle-exit=<seconds>] [--every=<seconds>]\n' +
  '       construct daemon status\n' +
  '       construct daemon stop\n' +
  '       construct daemon run [--foreground] [--idle-exit=<seconds>] [--every=<seconds>]\n' +
  '         (residency is opt-in; nothing raises this but these verbs)\n';

/** How long a start waits for the daemon it spawned to answer on the socket. */
const START_TIMEOUT_MS = 10_000;

/**
 * The launcher, resolved from this module rather than from argv. A packaged
 * install and a dev checkout both keep bin/ two levels above this file, and
 * argv[0] is whatever happened to load the CLI — a test runner, a host, an
 * MCP server — none of which can be spawned as Construct.
 */
function launcherPath(): string {
  return fileURLToPath(new URL('../../bin/construct.mjs', import.meta.url));
}

function positiveSeconds(raw: string | undefined, fallback: number, floor: number): number | null {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.max(value, floor);
}

/**
 * One exchange with whichever daemon owns the socket, or null when nothing
 * does. Both ends greet before either acts, so a version disagreement is known
 * before the request is served rather than after.
 */
async function talk(
  socketPath: string,
  request: Request,
): Promise<{ readonly hello: Hello; readonly reply: Reply } | null> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath);
    const reader = new LineReader();
    let hello: Hello | null = null;
    let reply: Reply | null = null;
    let settled = false;

    socket.setEncoding('utf8');
    socket.setTimeout(START_TIMEOUT_MS, () => {
      settled = true;
      socket.destroy();
      reject(new Error('the daemon accepted the connection and never answered'));
    });
    socket.on('connect', () => {
      socket.write(encodeLine({ v: packageVersion(), proto: PROTOCOL }));
      socket.write(encodeLine(request));
    });
    socket.on('data', (chunk: string) => {
      for (const line of reader.push(chunk)) {
        if (hello === null) {
          hello = parseHello(line);
          continue;
        }
        try {
          reply = JSON.parse(line) as Reply;
        } catch {
          reply = { ok: false, problem: 'the daemon answered with something that was not a reply' };
        }
      }
    });
    socket.on('error', (error: NodeJS.ErrnoException) => {
      if (settled) return;
      settled = true;
      // Nothing listening is the designed state, not a failure to report.
      if (error.code === 'ENOENT' || error.code === 'ECONNREFUSED') resolve(null);
      else reject(error);
    });
    socket.on('close', () => {
      if (settled) return;
      settled = true;
      if (hello === null || reply === null) {
        reject(new Error('the daemon hung up before answering'));
        return;
      }
      resolve({ hello, reply });
    });
  });
}

/** Where the daemon's own state lives, computed once per invocation. */
function places(): { readonly socket: string; readonly log: string; readonly pid: string } {
  const paths = resolvePaths();
  return {
    socket: daemonSocketPath(paths),
    log: daemonLogPath(paths),
    pid: daemonPidPath(paths),
  };
}

function ensurePlaces(): void {
  ensureStateDir(resolvePaths());
}

async function waitForSocket(socketPath: string, deadline: number): Promise<boolean> {
  for (;;) {
    if (await daemonIsLive(socketPath, 500)) return true;
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function waitForSocketGone(socketPath: string, deadline: number): Promise<boolean> {
  for (;;) {
    if (!socketFileExists(socketPath)) return true;
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/**
 * The one spawn path. Detached with its streams pointed at the logfile, so the
 * daemon outlives the shell that asked for it and a crash lands somewhere a
 * person can read rather than down a closed pipe. The heap cap goes on because
 * neither launchd nor a bare `nohup` offers one, and a resident process with no
 * ceiling is the failure that shows up as a machine, not as a log line.
 */
async function daemonStart(flags: Record<string, string>): Promise<number> {
  const idle = positiveSeconds(flags['idle-exit'], DEFAULT_IDLE_EXIT_SECONDS, IDLE_EXIT_FLOOR_SECONDS);
  const every = positiveSeconds(flags.every, DEFAULT_SWEEP_INTERVAL_MS / 1000, 1);
  if (idle === null || every === null) {
    process.stderr.write('daemon: --idle-exit and --every take a positive number of seconds\n');
    return 2;
  }

  ensurePlaces();
  const where = places();
  if (await daemonIsLive(where.socket)) {
    process.stdout.write(`already running, on ${where.socket}\n  read it with: construct daemon status\n`);
    return 0;
  }

  const logFd = openSync(where.log, 'a', 0o600);
  const nodeOptions = `${process.env.NODE_OPTIONS ?? ''} --max-old-space-size=256`.trim();
  const child = spawn(
    process.execPath,
    [
      launcherPath(),
      'daemon',
      'run',
      `--idle-exit=${String(idle)}`,
      `--every=${String(every)}`,
    ],
    {
      detached: true,
      stdio: ['ignore', logFd, logFd],
      // The daemon serves the store this working directory resolves, which is
      // the one the person asking for it is working in.
      cwd: process.cwd(),
      env: { ...process.env, NODE_OPTIONS: nodeOptions },
    },
  );
  child.unref();
  // Advisory only. The socket is the lock; this is here so a person reading
  // `ps` can tell which process is theirs.
  if (child.pid !== undefined) writeFileSync(where.pid, `${String(child.pid)}\n`, { mode: 0o600 });

  if (!(await waitForSocket(where.socket, Date.now() + START_TIMEOUT_MS))) {
    process.stderr.write(
      `daemon: spawned, but nothing answered on ${where.socket} within ` +
        `${String(START_TIMEOUT_MS / 1000)}s — read ${where.log}\n`,
    );
    return 1;
  }

  process.stdout.write(
    `started on ${where.socket}\n` +
      `  sweeping every ${String(every)}s; exits itself after ${String(idle)}s idle\n` +
      `  log: ${where.log}\n` +
      '  it sweeps watches and re-files due standing outcomes; it never spends —\n' +
      '  run `construct work` to work what it files.\n',
  );
  return 0;
}

function describeStatus(reply: StatusReply): string {
  const counts =
    reply.standingDue === null || reply.watchDue === null
      ? '  due: unavailable (the store could not be read)\n'
      : `  due: ${String(reply.standingDue)} standing, ${String(reply.watchDue)} watch\n`;
  return (
    `running (version ${reply.version})\n` +
    `  uptime: ${String(reply.uptimeSeconds)}s; idle ${String(reply.idleSeconds)}s of ` +
    `${String(reply.idleExitSeconds)}s before it exits itself\n` +
    `  sweeps: ${String(reply.sweeps)}\n` +
    `  store: ${reply.storePath}\n` +
    counts
  );
}

/**
 * What a client says when it turns out to be newer than the daemon it reached.
 * The daemon exits itself after answering, so the correct next move is a plain
 * restart; no respawn happens here, because a start the user did not type is
 * exactly the thing this design refuses.
 */
function staleNotice(daemonVersion: string): string {
  return (
    `\nthis build is ${packageVersion()} and the daemon was ${daemonVersion} — ` +
    'the stale daemon exited.\n  run `construct daemon start` again to raise the current one.\n'
  );
}

async function daemonStatus(): Promise<number> {
  const where = places();
  let answer: Awaited<ReturnType<typeof talk>>;
  try {
    answer = await talk(where.socket, { cmd: 'status' });
  } catch (error) {
    process.stderr.write(`daemon: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
  if (answer === null) {
    process.stdout.write('not running (designed state)\n  start one with: construct daemon start\n');
    return 0;
  }
  if (!answer.reply.ok) {
    process.stderr.write(`daemon: ${answer.reply.problem}\n`);
    return 1;
  }
  if ('stopping' in answer.reply) {
    process.stdout.write('stopping\n');
    return 0;
  }
  process.stdout.write(describeStatus(answer.reply));
  if (compareVersions(packageVersion(), answer.hello.v) > 0) {
    process.stdout.write(staleNotice(answer.hello.v));
  }
  return 0;
}

async function daemonStop(): Promise<number> {
  const where = places();
  let answer: Awaited<ReturnType<typeof talk>>;
  try {
    answer = await talk(where.socket, { cmd: 'stop' });
  } catch (error) {
    process.stderr.write(`daemon: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
  if (answer === null) {
    // A socket file with nothing behind it is the leftover of a killed
    // daemon; saying "already stopped" and clearing it is the whole truth.
    rmSync(where.socket, { force: true });
    rmSync(where.pid, { force: true });
    process.stdout.write('already stopped (designed state)\n');
    return 0;
  }
  if (!(await waitForSocketGone(where.socket, Date.now() + START_TIMEOUT_MS))) {
    process.stderr.write(`daemon: asked it to stop, but ${where.socket} is still there\n`);
    return 1;
  }
  rmSync(where.pid, { force: true });
  process.stdout.write('stopped\n');
  return 0;
}

/**
 * One pass over everything due, and the reason nothing here can spend: the two
 * seams called are the same ones `construct watch --due` and
 * `construct standing --due` call, minus the half of standing that dispatches
 * to a host. Whatever a run needs a credential for is left filed, named in the
 * log, and waiting for a person's `construct work`.
 */
function sweepOnce(): SweepOutcome {
  return withStore((store) => {
    const lines: string[] = [];
    const swept = sweepDueSourceWatches(store, now);
    for (const sweep of swept) {
      if (sweep.skipped !== null) {
        lines.push(`watch ${sweep.watch} skipped: ${sweep.skipped}`);
        continue;
      }
      lines.push(
        `watch ${sweep.watch} swept ${sweep.ground}: ${String(sweep.findings)} finding(s), ` +
          `${String(sweep.raised)} raised`,
      );
    }
    const { filed, unfinished } = fileDueStanding(store, now);
    for (const item of filed) {
      lines.push(
        `standing ${item.standing} came due; filed ${item.run} — nothing spent here, ` +
          `work it with: construct work --run=${item.run}`,
      );
    }
    for (const item of unfinished) {
      lines.push(
        `standing ${item.standing} left ${item.run} unfinished — the daemon holds no ` +
          `credentials, so it waits for: construct work --run=${item.run}`,
      );
    }
    return { foundWork: swept.length > 0 || filed.length > 0 || unfinished.length > 0, lines };
  });
}

function dueCounts(): DaemonCounts {
  try {
    return withStore((store) => {
      const at = now();
      return { standingDue: dueStanding(store, at).length, watchDue: dueSourceWatches(store, at).length };
    });
  } catch {
    // A status request must answer even when the store cannot be opened; the
    // daemon's own liveness is the question, and the counts are the extra.
    return { standingDue: null, watchDue: null };
  }
}

/**
 * The loop itself, in this process. `start` spawns exactly this, and a
 * supervisor unit would exec exactly this; `--foreground` changes only where
 * the log goes and whether the idle floor applies, because a person watching a
 * foreground run is the one case where a short quiet period is what was meant.
 */
async function daemonRun(flags: Record<string, string>): Promise<number> {
  const foreground = flags.foreground !== undefined;
  const idle = positiveSeconds(
    flags['idle-exit'],
    DEFAULT_IDLE_EXIT_SECONDS,
    foreground ? 0 : IDLE_EXIT_FLOOR_SECONDS,
  );
  const every = positiveSeconds(flags.every, DEFAULT_SWEEP_INTERVAL_MS / 1000, foreground ? 0 : 1);
  if (idle === null || every === null) {
    process.stderr.write('daemon: --idle-exit and --every take a positive number of seconds\n');
    return 2;
  }

  ensurePlaces();
  const where = places();
  const log = foreground ? stderrDaemonLog() : openDaemonLog(where.log);
  const removeCrashHandlers = installCrashHandlers(log);

  let storePath: string;
  try {
    storePath = resolveStoreLocation(process.cwd(), process.env).path;
  } catch (error) {
    log.write(`refusing to start: ${error instanceof Error ? error.message : String(error)}`);
    log.close();
    removeCrashHandlers();
    return 1;
  }

  const handle = await startDaemon({
    socketPath: where.socket,
    version: packageVersion(),
    idleExitSeconds: idle,
    sweepIntervalMs: every * 1000,
    sweep: async () => sweepOnce(),
    counts: dueCounts,
    storePath,
    log,
  });

  if (handle === null) {
    log.write('a live daemon already owns the socket; this one is not needed');
    log.close();
    removeCrashHandlers();
    if (foreground) process.stderr.write('daemon: already running\n');
    return 0;
  }

  const onSignal = (): void => {
    handle.stop('signal');
  };
  process.on('SIGTERM', onSignal);
  process.on('SIGINT', onSignal);

  await handle.stopped;

  process.removeListener('SIGTERM', onSignal);
  process.removeListener('SIGINT', onSignal);
  removeCrashHandlers();
  rmSync(where.pid, { force: true });
  return 0;
}

/**
 * The opt-in resident. Every subcommand here is something a person typed;
 * nothing else in the codebase can raise the loop.
 */
export async function daemon(argv: string[]): Promise<number> {
  const { flags, words } = splitFlags(argv);
  const sub = words[0];

  if (sub === 'start') return daemonStart(flags);
  if (sub === 'status') return daemonStatus();
  if (sub === 'stop') return daemonStop();
  if (sub === 'run') return daemonRun(flags);

  process.stderr.write(DAEMON_USAGE);
  return 2;
}
