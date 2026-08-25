/**
 * kernel/daemon/log.ts — the daemon's one account of itself.
 *
 * A resident process with nowhere to say what it did is a process nobody can
 * debug, and a resident process that says it without bound is a disk filling
 * up while nothing watches. One file, rotated once at open, is both answers:
 * the rotation happens when a daemon starts rather than on a timer, so nothing
 * about the writing path has to check a size, and a machine that never restarts
 * the daemon is a machine whose daemon is not writing much either.
 */

import { closeSync, openSync, renameSync, statSync, writeSync } from 'node:fs';

/** Where one line goes. Closing is the caller's, and happens on shutdown. */
export interface DaemonLog {
  readonly write: (line: string) => void;
  readonly close: () => void;
}

/** Past this, the log is rolled aside at the next open. */
export const LOG_ROTATE_BYTES = 5 * 1024 * 1024;

function stamped(line: string): string {
  return `${new Date().toISOString()} ${line}\n`;
}

/**
 * Opens the log for append, rolling an oversized one aside first. Exactly one
 * previous generation is kept: a daemon log is for reading the last thing that
 * happened, and keeping more of them is a retention policy nobody asked for.
 */
export function openDaemonLog(logPath: string): DaemonLog {
  try {
    if (statSync(logPath).size > LOG_ROTATE_BYTES) renameSync(logPath, `${logPath}.1`);
  } catch {
    // No log yet, or a rename that lost a race with another rotation. Either
    // way the append below creates what is needed; a log that cannot be
    // rotated is not a reason to refuse to run.
  }
  const fd = openSync(logPath, 'a', 0o600);
  return {
    write: (line) => {
      writeSync(fd, stamped(line));
    },
    close: () => {
      closeSync(fd);
    },
  };
}

/**
 * The foreground log: the operator's own error stream, because a foreground
 * run is being watched by the person who started it and a file they would have
 * to tail in another window is worse than the terminal in front of them.
 */
export function stderrDaemonLog(): DaemonLog {
  return {
    write: (line) => {
      process.stderr.write(stamped(line));
    },
    close: () => {},
  };
}
