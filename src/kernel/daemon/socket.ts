/**
 * kernel/daemon/socket.ts — the daemon's identity.
 *
 * There is no pidfile lock here, deliberately. A pidfile is a claim about a
 * process that a reader has to go and check, and every check races: the pid
 * can be recycled, the file can outlive the writer, and two starts can both
 * read "absent" before either writes. Binding a unix socket is the check and
 * the claim at once — the kernel refuses the second bind — so the daemon's
 * identity IS the socket, and the only stale state possible is a file whose
 * owner is gone, which connect answers definitively.
 *
 * The path is keyed to the state directory and never to the working directory.
 * A second checkout, a worktree, or a packaged install run from anywhere else
 * resolves the same state directory and therefore the same socket, so it finds
 * the live daemon instead of raising a second one against the same store.
 */

import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { createConnection, createServer } from 'node:net';
import type { Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Paths } from '../paths.ts';

/**
 * A unix socket path must fit sun_path, which macOS caps at 104 bytes; a path
 * past the cap fails listen() with EINVAL, so a state directory nested deep
 * enough could never host a daemon at all. Held a few bytes under the cap so
 * the count never argues with a trailing NUL.
 */
const SOCKET_PATH_BYTE_BUDGET = 100;

/**
 * Where the daemon binds. Keyed to the state directory, never to the cwd, so
 * every checkout against the same store computes the same socket. When the
 * natural path inside the state directory would overrun the sun_path budget,
 * the key survives as a digest of the state directory in the system tmp dir —
 * still one socket per store, from any client, just at an address short
 * enough for the kernel to accept.
 */
export function daemonSocketPath(paths: Paths, tmpBase: string = tmpdir()): string {
  const natural = join(paths.stateDir, 'daemon.sock');
  if (Buffer.byteLength(natural, 'utf8') <= SOCKET_PATH_BYTE_BUDGET) return natural;
  const key = createHash('sha256').update(paths.stateDir).digest('hex').slice(0, 16);
  return join(tmpBase, `construct-daemon-${key}.sock`);
}

/** Where the daemon writes its account of itself. */
export function daemonLogPath(paths: Paths): string {
  return join(paths.stateDir, 'daemon.log');
}

/**
 * Advisory metadata only: which process the socket's owner happens to be, for
 * a human reading `ps`. Nothing decides anything from this file — the socket
 * is the lock, and a pid read back from disk is a claim, not a check.
 */
export function daemonPidPath(paths: Paths): string {
  return join(paths.stateDir, 'daemon.pid');
}

/** The state directory, private to its owner, created if it is not there. */
export function ensureStateDir(paths: Paths): void {
  mkdirSync(paths.stateDir, { recursive: true, mode: 0o700 });
}

/** Whether something is listening on this socket right now. */
export async function daemonIsLive(socketPath: string, timeoutMs = 2000): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const socket = createConnection(socketPath);
    let settled = false;
    const finish = (live: boolean): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(live);
    };
    socket.setTimeout(timeoutMs, () => {
      finish(false);
    });
    socket.on('connect', () => {
      finish(true);
    });
    socket.on('error', () => {
      finish(false);
    });
  });
}

export type BindOutcome =
  | { readonly kind: 'bound'; readonly server: Server }
  | { readonly kind: 'live' };

function listen(server: Server, socketPath: string): Promise<null | NodeJS.ErrnoException> {
  return new Promise((resolve) => {
    const onError = (error: NodeJS.ErrnoException): void => {
      server.removeListener('listening', onListening);
      resolve(error);
    };
    const onListening = (): void => {
      server.removeListener('error', onError);
      resolve(null);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(socketPath);
  });
}

/**
 * Bind the socket, or report that a live daemon already owns it.
 *
 * The address-in-use branch is the whole protection. A socket file left behind
 * by a killed daemon looks identical on disk to one a live daemon is listening
 * on, and the difference is only visible by connecting: a live owner accepts, a
 * dead one refuses. So the refusal — and only the refusal — earns an unlink and
 * a second bind. Deleting on the strength of the file's existence alone is how
 * a running daemon gets evicted by the next start.
 */
export async function bindDaemonSocket(socketPath: string): Promise<BindOutcome> {
  const server = createServer();
  const first = await listen(server, socketPath);
  if (first === null) {
    chmodSync(socketPath, 0o600);
    return { kind: 'bound', server };
  }
  if (first.code !== 'EADDRINUSE') {
    server.close();
    throw first;
  }
  if (await daemonIsLive(socketPath)) {
    server.close();
    return { kind: 'live' };
  }
  rmSync(socketPath, { force: true });
  const second = await listen(server, socketPath);
  if (second !== null) {
    server.close();
    throw second;
  }
  chmodSync(socketPath, 0o600);
  return { kind: 'bound', server };
}

/** Whether the socket file is on disk at all, live or stale. */
export function socketFileExists(socketPath: string): boolean {
  try {
    statSync(socketPath);
    return true;
  } catch {
    return false;
  }
}
