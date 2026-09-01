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
import type { Paths } from '../kernel/paths.ts';
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
  '       construct daemon run [--foreground] [--idle-exit=<seconds>|never] [--every=<seconds>]\n' +
  '         (residency is opt-in; nothing raises this but these verbs.\n' +
  '          --idle-exit=never is for a platform supervisor to run; a detached\n' +
  '          start always keeps its idle clock)\n';

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

/** What `--idle-exit=never` spells on the wire between the unit and the loop. */
export const IDLE_EXIT_NEVER = 'never';

/**
 * The quiet period, or the word that turns the clock off. Null is a refusal,
 * and the caller decides whether `never` is one: an entry a supervisor owns
 * may name it, a detached start may not, because the idle clock is the only
 * thing that reaps a start nobody is accountable for.
 */
function idleExitSeconds(
  raw: string | undefined,
  fallback: number,
  floor: number,
  allowNever: boolean,
): number | null | 'refused' {
  if (raw === IDLE_EXIT_NEVER) return allowNever ? null : 'refused';
  const value = positiveSeconds(raw, fallback, floor);
  return value === null ? 'refused' : value;
}

/**
 * What a detached daemon is given to run with. An allowlist, not the parent's
 * environment: this process may hold credentials a person exported for one
 * command, and a resident that inherits them holds them for as long as it
 * lives. What survives is what the child genuinely needs — where to find
 * binaries, whose home and state directories to resolve, which store the
 * project asked for, and the heap cap — and every other name, secret or not,
 * is left behind.
 */
export function daemonChildEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const carried = [
    'PATH',
    'HOME',
    'TMPDIR',
    'LANG',
    'LC_ALL',
    // kernel/paths.ts reads exactly these to place the state, data, config and
    // cache directories; without them a detached daemon resolves a different
    // store than the person who started it.
    'XDG_CONFIG_HOME',
    'XDG_STATE_HOME',
    'XDG_DATA_HOME',
    'XDG_CACHE_HOME',
    // Whether this project keeps its store in the repository rather than in
    // the home directory: the one setting that moves the store itself.
    'CONSTRUCT_STATE',
  ];
  const child: NodeJS.ProcessEnv = {};
  for (const key of carried) {
    const value = env[key];
    if (value !== undefined) child[key] = value;
  }
  child.NODE_OPTIONS = `${env.NODE_OPTIONS ?? ''} --max-old-space-size=256`.trim();
  return child;
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
    // Nothing listening is the designed state, not a failure to report — and
    // neither is a daemon that went while this exchange was in flight. An
    // install that replaced the binary leaves an older daemon that reads this
    // build's hello, retires, and takes the connection with it; what the
    // client wants said about that is that nothing is running, because
    // nothing is.
    const gone = new Set(['ENOENT', 'ECONNREFUSED', 'EPIPE', 'ECONNRESET']);
    socket.on('error', (error: NodeJS.ErrnoException) => {
      if (settled) return;
      settled = true;
      if (error.code !== undefined && gone.has(error.code)) resolve(null);
      else reject(error);
    });
    socket.on('close', () => {
      if (settled) return;
      settled = true;
      // A daemon that greeted and then went is a daemon that read our hello,
      // found itself older than this build, and retired — which is the design
      // working. Nothing is running afterwards, and that is the same answer as
      // nothing having been running at all.
      if (hello === null) {
        reject(new Error('the daemon hung up before answering'));
        return;
      }
      if (reply === null) {
        resolve(null);
        return;
      }
      resolve({ hello, reply });
    });
  });
}

/**
 * What `doctor` (and anything else that only wants to look, not act) can
 * learn about the daemon without sending it a `stop`: whether the socket is
 * absent, present but answering nobody's home (stale), or a live daemon that
 * answered a status request. Shares the one client seam (`talk`) that
 * `daemon status` itself uses, so the two surfaces can never disagree about
 * what "running" means. `socketPath` rides along on the two non-live states
 * so a caller can name where it looked without resolving the path itself.
 */
export type DaemonProbe =
  | { readonly state: 'absent'; readonly socketPath: string }
  | { readonly state: 'stale'; readonly socketPath: string }
  | { readonly state: 'live'; readonly hello: Hello; readonly reply: StatusReply };

/**
 * A read-only look at whichever daemon owns this machine's socket, never
 * throwing: a probe that could throw would make `doctor` crash on exactly the
 * residue it exists to report. Absent (no socket file) and stale (a socket
 * file nothing answers on) are both "not live" but are named differently
 * because they call for different action — nothing, versus
 * `construct daemon start` reaping the file.
 */
export async function probeDaemon(paths: Paths): Promise<DaemonProbe> {
  const socketPath = daemonSocketPath(paths);
  if (!socketFileExists(socketPath)) return { state: 'absent', socketPath };
  let answer: Awaited<ReturnType<typeof talk>>;
  try {
    answer = await talk(socketPath, { cmd: 'status' });
  } catch {
    return { state: 'stale', socketPath };
  }
  if (answer === null || !answer.reply.ok || !('version' in answer.reply)) {
    return { state: 'stale', socketPath };
  }
  return { state: 'live', hello: answer.hello, reply: answer.reply };
}

/**
 * What a start finds when something already owns the socket.
 *
 * A bare connect answers "somebody is there" and nothing else, which is the
 * wrong question on a machine that updates: an install that replaced the
 * binary leaves an older daemon holding the socket, and only the version
 * handshake a real request carries can see it. So a start talks rather than
 * connects, and the three answers it can get are the three different things it
 * must do.
 */
export type RunningDaemon =
  | { readonly kind: 'none' }
  | { readonly kind: 'already-running' }
  | { readonly kind: 'retired'; readonly notice: string }
  | { readonly kind: 'serving-elsewhere'; readonly notice: string };

/**
 * What a start says when the daemon it found is serving a different store than
 * the directory it was typed in resolves. Two stores want two daemons and the
 * socket only admits one, so this is stated and nothing is raised — a second
 * daemon would bind nothing, and attaching this repository's work to the other
 * store's resident would file it where nobody is looking for it.
 */
export function storeMismatchNotice(daemonStore: string, thisStore: string): string | null {
  if (daemonStore === thisStore) return null;
  return (
    `daemon: a daemon is running but serves ${daemonStore}; this repository's store is ${thisStore}\n` +
    '  stop it where it was started (construct daemon stop), or run this repository\'s\n' +
    '  due work directly with: construct standing --due && construct watch --due\n'
  );
}

/** What a client says when the daemon it reached turned out to be an older build. */
function retiredNotice(daemonVersion: string): string {
  return (
    `the daemon on this machine was ${daemonVersion} and this build is ${packageVersion()} — ` +
    'it retired itself; raising the current one.\n'
  );
}

async function inspectRunningDaemon(socketPath: string): Promise<RunningDaemon> {
  let answer: Awaited<ReturnType<typeof talk>>;
  try {
    answer = await talk(socketPath, { cmd: 'status' });
  } catch {
    // Something is on the socket that will not hold a conversation. The bind
    // itself is the arbiter from here: it finds a live owner or clears a dead
    // one, and neither outcome is decided by guessing at this.
    return { kind: 'none' };
  }
  if (answer === null || !answer.reply.ok || !('version' in answer.reply)) return { kind: 'none' };

  if (compareVersions(packageVersion(), answer.reply.version) > 0) {
    // The hello this request carried already told it so; it answers this one
    // request and exits. Waiting for the socket to go is what makes the
    // respawn below a start rather than a race against a dying daemon.
    await waitForSocketGone(socketPath, Date.now() + START_TIMEOUT_MS);
    return { kind: 'retired', notice: retiredNotice(answer.reply.version) };
  }

  let thisStore: string;
  try {
    thisStore = resolveStoreLocation(process.cwd(), process.env).path;
  } catch {
    // Where this directory's store would be is unanswerable, so there is no
    // mismatch to claim; the live daemon is simply already running.
    return { kind: 'already-running' };
  }
  const mismatch = storeMismatchNotice(answer.reply.storePath, thisStore);
  if (mismatch !== null) return { kind: 'serving-elsewhere', notice: mismatch };
  return { kind: 'already-running' };
}

/**
 * Whether a daemon is live on this machine right now, for a caller that only
 * needs the fact and cannot do I/O of its own to get it.
 */
export async function daemonLiveHere(): Promise<boolean> {
  return (await probeDaemon(resolvePaths())).state === 'live';
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
  if (flags['idle-exit'] === IDLE_EXIT_NEVER) {
    process.stderr.write(
      'daemon: a detached start keeps its idle clock — nothing else would ever reap it.\n' +
        '  for a daemon that never exits on its own, install the supervised one:\n' +
        '    construct schedule install --always-on\n',
    );
    return 2;
  }
  const idle = positiveSeconds(flags['idle-exit'], DEFAULT_IDLE_EXIT_SECONDS, IDLE_EXIT_FLOOR_SECONDS);
  const every = positiveSeconds(flags.every, DEFAULT_SWEEP_INTERVAL_MS / 1000, 1);
  if (idle === null || every === null) {
    process.stderr.write('daemon: --idle-exit and --every take a positive number of seconds\n');
    return 2;
  }

  ensurePlaces();
  const where = places();
  const standing = await inspectRunningDaemon(where.socket);
  if (standing.kind === 'serving-elsewhere') {
    process.stderr.write(standing.notice);
    return 1;
  }
  if (standing.kind === 'already-running') {
    process.stdout.write(`already running, on ${where.socket}\n  read it with: construct daemon status\n`);
    return 0;
  }
  if (standing.kind === 'retired') {
    process.stdout.write(standing.notice);
  }

  const logFd = openSync(where.log, 'a', 0o600);
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
      env: daemonChildEnv(process.env),
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
  const idle =
    reply.idleExitSeconds === null
      ? `  uptime: ${String(reply.uptimeSeconds)}s; idle ${String(reply.idleSeconds)}s, and it never exits on idle — a supervisor owns it\n`
      : `  uptime: ${String(reply.uptimeSeconds)}s; idle ${String(reply.idleSeconds)}s of ` +
        `${String(reply.idleExitSeconds)}s before it exits itself\n`;
  return (
    `running (version ${reply.version})\n` +
    idle +
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
    // The filing's own narration is written for a terminal, and the daemon has
    // none: its stdout is a logfile whose every other line is timestamped.
    // Captured here and folded into the log's own lines rather than left to
    // land between them unstamped.
    const narration: string[] = [];
    const { filed, unfinished } = fileDueStanding(store, now, (text) => {
      for (const line of text.split('\n')) {
        if (line.trim() !== '') narration.push(line.trim());
      }
    });
    lines.push(...narration);
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
  const idle = idleExitSeconds(
    flags['idle-exit'],
    DEFAULT_IDLE_EXIT_SECONDS,
    foreground ? 0 : IDLE_EXIT_FLOOR_SECONDS,
    true,
  );
  const every = positiveSeconds(flags.every, DEFAULT_SWEEP_INTERVAL_MS / 1000, foreground ? 0 : 1);
  if (idle === 'refused' || every === null) {
    process.stderr.write(
      'daemon: --every takes a positive number of seconds, and --idle-exit takes one or the word never\n',
    );
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
