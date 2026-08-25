/**
 * kernel/daemon/loop.ts — the resident process, and every bound on it.
 *
 * The loop owns four things and nothing else: the socket it is identified by,
 * a coarse jittered timer, an idle clock, and the promise that resolves when it
 * has stopped. What the timer actually does arrives injected, so the kernel
 * never decides what due work is or reaches for a store — the same seam every
 * other kernel module keeps.
 *
 * The idle clock is the backstop under all of it. Every protection here can be
 * defeated by a defect somewhere else; a daemon that exits on its own after a
 * quiet period cannot become the thing a machine accumulates, whatever raised
 * it and whatever went wrong afterwards. It is turned off in exactly one case:
 * a daemon a platform supervisor raised and is accountable for, where exiting
 * on a quiet machine is the defect rather than the protection.
 */

import { rmSync } from 'node:fs';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import type { Socket } from 'node:net';
import { bindDaemonSocket } from './socket.ts';
import type { DaemonLog } from './log.ts';
import {
  compareVersions,
  encodeLine,
  LineReader,
  parseHello,
  parseRequest,
  PROTOCOL,
} from './protocol.ts';
import type { StatusReply, StopReply } from './protocol.ts';

/** What one pass over the due work found, and what it wants said about it. */
export interface SweepOutcome {
  /** True when the sweep found something due. A found sweep is not idle. */
  readonly foundWork: boolean;
  readonly lines: readonly string[];
}

/** The cheap counts a status request answers with; null where counting failed. */
export interface DaemonCounts {
  readonly standingDue: number | null;
  readonly watchDue: number | null;
}

export interface DaemonConfig {
  readonly socketPath: string;
  readonly version: string;
  /**
   * The quiet period after which the daemon exits itself, or null for a daemon
   * that never exits on its own. Null belongs to a supervised daemon and to
   * nothing else: the idle clock is the backstop that reaps an orphan nobody
   * is talking to, and only a platform supervisor — which starts, stops, and
   * accounts for the process itself — replaces it.
   */
  readonly idleExitSeconds: number | null;
  readonly sweepIntervalMs: number;
  readonly sweep: () => Promise<SweepOutcome>;
  readonly counts: () => DaemonCounts;
  /** Named in status so a reader can see which store the resident is serving. */
  readonly storePath: string;
  readonly log: DaemonLog;
  /** Milliseconds since the epoch. Injected so a test owns the clock. */
  readonly now?: () => number;
}

export type StopReason = 'idle' | 'client' | 'signal' | 'stale-version';

export interface DaemonHandle {
  readonly socketPath: string;
  /** Resolves once the socket is closed, the sweep has finished, and the file is gone. */
  readonly stopped: Promise<StopReason>;
  readonly stop: (reason: StopReason) => void;
}

/** The smallest quiet period the flag surface will accept. */
export const IDLE_EXIT_FLOOR_SECONDS = 60;

/** How often the daemon looks for due work when nothing says otherwise. */
export const DEFAULT_SWEEP_INTERVAL_MS = 60_000;

/** The default quiet period: long enough to be useful, short enough to reap. */
export const DEFAULT_IDLE_EXIT_SECONDS = 900;

/** Log-only: an event loop this blocked means the sweep is too heavy to be resident. */
const EVENT_LOOP_P99_LIMIT_MS = 1000;

/** ±10%, so a fleet of machines does not sweep in lockstep. */
function jittered(intervalMs: number): number {
  return Math.round(intervalMs * (0.9 + Math.random() * 0.2));
}

/**
 * Raise the daemon, or report that a live one already owns the socket.
 *
 * Null is the "someone else has it" answer, and it is the only correct one:
 * the caller's job then is to say so and exit, never to take the socket.
 */
export async function startDaemon(config: DaemonConfig): Promise<DaemonHandle | null> {
  const now = config.now ?? ((): number => Date.now());
  const bound = await bindDaemonSocket(config.socketPath);
  if (bound.kind === 'live') return null;
  const server = bound.server;

  const startedAt = now();
  let lastActivity = startedAt;
  let sweeps = 0;
  let inFlight: Promise<void> | null = null;
  let stopping: StopReason | null = null;
  const open = new Set<Socket>();

  let settle: (reason: StopReason) => void = () => {};
  const stopped = new Promise<StopReason>((resolve) => {
    settle = resolve;
  });

  const delay = monitorEventLoopDelay({ resolution: 20 });
  delay.enable();

  let sweepTimer: NodeJS.Timeout | null = null;
  let idleTimer: NodeJS.Timeout | null = null;
  let worstReportedP99 = 0;

  const status = (): StatusReply => {
    const counts = config.counts();
    return {
      ok: true,
      version: config.version,
      uptimeSeconds: Math.round((now() - startedAt) / 1000),
      idleSeconds: Math.round((now() - lastActivity) / 1000),
      idleExitSeconds: config.idleExitSeconds,
      sweeps,
      storePath: config.storePath,
      standingDue: counts.standingDue,
      watchDue: counts.watchDue,
    };
  };

  /**
   * Shutdown, in the one order that leaves nothing behind: stop accepting,
   * hang up on whoever is still connected, let the sweep in flight finish so
   * the store closes on its own terms, then remove the file that is this
   * daemon's identity. Removing it first would let the next start bind while
   * this one still holds the store.
   */
  const stop = (reason: StopReason): void => {
    if (stopping !== null) return;
    stopping = reason;
    if (sweepTimer !== null) clearTimeout(sweepTimer);
    if (idleTimer !== null) clearInterval(idleTimer);
    delay.disable();
    server.close();
    for (const socket of open) socket.destroy();
    open.clear();
    void (async () => {
      if (inFlight !== null) {
        config.log.write('shutdown: waiting for the sweep in flight');
        await inFlight;
      }
      rmSync(config.socketPath, { force: true });
      config.log.write(`stopped (${reason})`);
      config.log.close();
      settle(reason);
    })();
  };

  server.on('connection', (socket) => {
    open.add(socket);
    lastActivity = now();
    const reader = new LineReader();
    let greeted = false;
    let stale = false;
    socket.setEncoding('utf8');
    socket.write(encodeLine({ v: config.version, proto: PROTOCOL }));

    const answer = (payload: unknown): void => {
      socket.end(encodeLine(payload));
    };

    socket.on('data', (chunk: string) => {
      for (const line of reader.push(chunk)) {
        if (!greeted) {
          greeted = true;
          const hello = parseHello(line);
          if (hello === null || hello.proto !== PROTOCOL) {
            answer({ ok: false, problem: `expected a proto ${String(PROTOCOL)} hello` });
            return;
          }
          // An install that replaced the binary under a running daemon: the
          // newer client is right about what this machine now is, so the older
          // resident answers this one request and then gets out of the way
          // rather than serving stale behavior until something reaps it.
          stale = compareVersions(hello.v, config.version) > 0;
          if (stale) {
            config.log.write(`a newer client (${hello.v}) reached version ${config.version}; exiting after this request`);
          }
          continue;
        }
        const request = parseRequest(line);
        if (request === null) {
          answer({ ok: false, problem: 'unknown request' });
          return;
        }
        if (request.cmd === 'status') {
          answer(status());
          return;
        }
        const reply: StopReply = { ok: true, stopping: true };
        socket.end(encodeLine(reply), () => {
          stop('client');
        });
        return;
      }
    });

    socket.on('close', () => {
      open.delete(socket);
      lastActivity = now();
      if (stale && stopping === null) stop('stale-version');
    });
    socket.on('error', () => {
      open.delete(socket);
    });
  });

  /**
   * One sweep at a time, always. Overlapping sweeps against one store is how a
   * coarse timer becomes a load generator the moment the work takes longer
   * than the interval, so a tick that finds the previous sweep still running
   * is skipped rather than queued.
   */
  const tick = (): void => {
    if (stopping !== null) return;
    if (inFlight !== null) {
      config.log.write('sweep skipped: the previous one is still running');
      return;
    }
    // Measured over the daemon's whole life, never reset. A reset re-arms the
    // monitor's baseline at the moment it is called, so a reset taken just
    // before a sweep makes that sweep's own blocking invisible — which is the
    // one stall this is here to see. Reported when it gets worse, so a daemon
    // that stalled once says so once rather than every minute afterwards.
    const p99 = delay.percentile(99) / 1e6;
    if (p99 > EVENT_LOOP_P99_LIMIT_MS && p99 > worstReportedP99) {
      worstReportedP99 = p99;
      config.log.write(`event loop p99 ${p99.toFixed(0)}ms exceeds ${String(EVENT_LOOP_P99_LIMIT_MS)}ms`);
    }
    const run = (async () => {
      try {
        const outcome = await config.sweep();
        sweeps += 1;
        for (const line of outcome.lines) config.log.write(line);
        // Work found is work happening: a machine with something to do is not
        // a machine nobody is using, so the quiet period starts over.
        if (outcome.foundWork) lastActivity = now();
      } catch (error) {
        // A sweep that failed is reported and the daemon keeps its schedule:
        // one unreachable source must not take the resident down, and the
        // crash-don't-linger handlers cover the failures that genuinely should.
        config.log.write(`sweep failed: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        inFlight = null;
      }
    })();
    inFlight = run;
  };

  // The timer runs on its own cadence rather than restarting itself when the
  // sweep finishes. That is what makes the skip above a real branch: a sweep
  // slower than the interval is the case worth protecting against, and a timer
  // that waits for the sweep can never observe it.
  const schedule = (): void => {
    sweepTimer = setTimeout(() => {
      if (stopping !== null) return;
      schedule();
      tick();
    }, jittered(config.sweepIntervalMs));
  };
  schedule();

  if (config.idleExitSeconds !== null) {
    const idleMs = config.idleExitSeconds * 1000;
    idleTimer = setInterval(
      () => {
        if (stopping !== null) return;
        if (open.size > 0 || inFlight !== null) {
          lastActivity = now();
          return;
        }
        if (now() - lastActivity >= idleMs) stop('idle');
      },
      Math.max(20, Math.min(1000, Math.round(idleMs / 4))),
    );
  }

  config.log.write(
    `listening on ${config.socketPath} (version ${config.version}, sweep every ` +
      `${String(Math.round(config.sweepIntervalMs / 1000))}s, ` +
      (config.idleExitSeconds === null
        ? 'no idle exit: the supervisor owns this process)'
        : `idle exit after ${String(config.idleExitSeconds)}s)`),
  );

  return { socketPath: config.socketPath, stopped, stop };
}

/**
 * Crash, do not linger. Node's default on an unhandled rejection or an
 * uncaught exception is to die, and that default is kept on purpose: a
 * resident process that swallows the errors it does not understand is a
 * resident process running in a state nobody designed. All these handlers add
 * is a line in the log before the same thing happens anyway, because a daemon
 * that died detached with its stack written to a closed stdout is a daemon
 * nobody can diagnose.
 *
 * Returns the function that removes them.
 */
export function installCrashHandlers(log: DaemonLog): () => void {
  const describe = (error: unknown): string =>
    error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error);

  const onException = (error: Error): void => {
    log.write(`uncaught exception: ${describe(error)}`);
    log.close();
    process.removeListener('uncaughtException', onException);
    throw error;
  };
  const onRejection = (reason: unknown): void => {
    log.write(`unhandled rejection: ${describe(reason)}`);
    log.close();
    process.removeListener('unhandledRejection', onRejection);
    throw reason;
  };

  process.on('uncaughtException', onException);
  process.on('unhandledRejection', onRejection);
  return () => {
    process.removeListener('uncaughtException', onException);
    process.removeListener('unhandledRejection', onRejection);
  };
}
