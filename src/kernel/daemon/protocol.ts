/**
 * kernel/daemon/protocol.ts — what the two ends of the daemon socket say to
 * each other, and how each decides the other is worth talking to.
 *
 * Newline-delimited JSON, one object per line, and the first line each side
 * writes is a hello carrying the build's version and the protocol number. That
 * ordering is the whole point: an install that replaced the binary under a
 * running daemon is the ordinary case on a machine that updates, and the only
 * moment either end can catch it is before a request is acted on.
 */

/** The wire format's own number. It changes when the message shapes change. */
export const PROTOCOL = 1;

/** The first line each side writes on a fresh connection. */
export interface Hello {
  readonly v: string;
  readonly proto: number;
}

/** Everything a client may ask for. */
export type Request = { readonly cmd: 'status' } | { readonly cmd: 'stop' };

/** What a daemon answers a status request with. */
export interface StatusReply {
  readonly ok: true;
  readonly version: string;
  readonly uptimeSeconds: number;
  readonly idleSeconds: number;
  /** Null when the idle clock is off, which only a supervised daemon asks for. */
  readonly idleExitSeconds: number | null;
  readonly sweeps: number;
  readonly storePath: string;
  /** Absent when counting would have cost more than the answer is worth. */
  readonly standingDue: number | null;
  readonly watchDue: number | null;
}

/** What a daemon answers a stop request with, immediately before it stops. */
export interface StopReply {
  readonly ok: true;
  readonly stopping: true;
}

export type Reply = StatusReply | StopReply | { readonly ok: false; readonly problem: string };

export function encodeLine(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}

/**
 * A hello that came off the wire, or null when the line was not one.
 *
 * Null rather than a throw because the other end of a unix socket in a shared
 * state directory is not guaranteed to be Construct at all, and a stranger's
 * first line is a fact to report, not a crash to take.
 */
export function parseHello(line: string): Hello | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const candidate = parsed as { v?: unknown; proto?: unknown };
  if (typeof candidate.v !== 'string' || typeof candidate.proto !== 'number') return null;
  return { v: candidate.v, proto: candidate.proto };
}

/** A request that came off the wire, or null when the line was not one. */
export function parseRequest(line: string): Request | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const cmd = (parsed as { cmd?: unknown }).cmd;
  if (cmd === 'status' || cmd === 'stop') return { cmd };
  return null;
}

function identifiers(version: string): { core: number[]; pre: string[] } {
  const [core, ...preParts] = version.split('-');
  return {
    core: core.split('.').map((part) => Number.parseInt(part, 10) || 0),
    pre: preParts.join('-').split('.').filter((part) => part.length > 0),
  };
}

/**
 * -1, 0, or 1, comparing two versions the way the ecosystem's own ordering
 * does: numeric release parts first, and a build carrying a prerelease tag
 * ordered below the same release without one.
 *
 * Written here rather than taken from a library because the zero-dependency
 * rule holds, and because the only question asked of it is "is the other end
 * newer than me" — a comparison whose wrong answer costs one respawn.
 */
export function compareVersions(left: string, right: string): -1 | 0 | 1 {
  const a = identifiers(left);
  const b = identifiers(right);
  const width = Math.max(a.core.length, b.core.length);
  for (let index = 0; index < width; index += 1) {
    const one = a.core[index] ?? 0;
    const two = b.core[index] ?? 0;
    if (one !== two) return one < two ? -1 : 1;
  }
  if (a.pre.length === 0 && b.pre.length > 0) return 1;
  if (a.pre.length > 0 && b.pre.length === 0) return -1;
  const preWidth = Math.max(a.pre.length, b.pre.length);
  for (let index = 0; index < preWidth; index += 1) {
    const one = a.pre[index];
    const two = b.pre[index];
    if (one === two) continue;
    if (one === undefined) return -1;
    if (two === undefined) return 1;
    const oneNumeric = /^\d+$/.test(one);
    const twoNumeric = /^\d+$/.test(two);
    if (oneNumeric && twoNumeric) return Number(one) < Number(two) ? -1 : 1;
    if (oneNumeric !== twoNumeric) return oneNumeric ? -1 : 1;
    return one < two ? -1 : 1;
  }
  return 0;
}

/**
 * Reassembles newline-delimited JSON out of whatever chunk sizes the socket
 * happens to deliver. A message split across two reads is the ordinary case on
 * a busy socket, and treating each chunk as a line is the bug that only shows
 * up under load.
 */
export class LineReader {
  buffer = '';

  /** Every complete line in this chunk, in order. */
  push(chunk: string): string[] {
    this.buffer += chunk;
    const lines: string[] = [];
    for (;;) {
      const cut = this.buffer.indexOf('\n');
      if (cut < 0) break;
      lines.push(this.buffer.slice(0, cut));
      this.buffer = this.buffer.slice(cut + 1);
    }
    return lines;
  }
}
