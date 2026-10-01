/**
 * kernel/safety/containment.ts — one path-containment primitive for every
 * reader that touches the filesystem on a project's behalf.
 *
 * A path is admissible when every component from the project root to the
 * target, after resolving this hop's real path, stays inside the root.
 * Intermediate symlinks are allowed only when they resolve inside.
 * A link that escapes, a missing hop, or a path that changes between the
 * check and the open is a refusal, not a silent skip dressed as empty.
 *
 * A check-then-open race remains: another process can replace a file after
 * lstat and before open. Callers that need a stable read open with
 * O_NOFOLLOW on the final hop, or re-stat the fd. This module does not
 * claim to defeat every race.
 */

import { lstatSync, realpathSync, closeSync, openSync, readSync, constants, type Stats } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

export class ContainmentError extends Error {
  readonly root: string;
  readonly path: string;
  readonly reason: string;

  constructor(root: string, path: string, reason: string) {
    super(`${path}: ${reason}`);
    this.name = 'ContainmentError';
    this.root = root;
    this.path = path;
    this.reason = reason;
  }
}

export type ContainmentVerdict =
  | { readonly ok: true; readonly realPath: string; readonly stat: Stats; readonly viaSymlink: boolean }
  | { readonly ok: false; readonly reason: string; readonly path: string };

function canonicalize(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

function normalizeRoot(root: string): string {
  return canonicalize(root);
}

/** True when `candidate` is `root` or a descendant after both are canonicalized. */
export function isInside(root: string, candidate: string): boolean {
  const rel = relative(normalizeRoot(root), canonicalize(candidate));
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !rel.startsWith('..'));
}

/**
 * Walk from `root` to `target`, refusing any hop whose real path leaves the
 * root. Does not follow the final hop when it is a symlink until the realpath
 * of that hop is itself contained.
 */
export function inspectContained(root: string, target: string): ContainmentVerdict {
  const absRoot = normalizeRoot(root);
  const absTarget = resolve(absRoot, target);
  if (!isInside(absRoot, absTarget)) {
    return { ok: false, reason: 'path is outside the project root', path: absTarget };
  }
  const rel = relative(absRoot, absTarget);
  if (rel.startsWith(`..${sep}`) || rel === '..') {
    return { ok: false, reason: 'path is outside the project root', path: absTarget };
  }
  let current = absRoot;
  let viaSymlink = false;
  const parts = rel === '' ? [] : rel.split(sep);
  for (const part of parts) {
    current = join(current, part);
    let st: Stats;
    try {
      st = lstatSync(current);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return { ok: false, reason: 'path does not exist', path: current };
      return { ok: false, reason: code ?? 'cannot stat', path: current };
    }
    if (st.isSymbolicLink()) {
      viaSymlink = true;
      let real: string;
      try {
        real = realpathSync(current);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') return { ok: false, reason: 'symlink target does not exist', path: current };
        return { ok: false, reason: 'symlink cannot be resolved', path: current };
      }
      if (!isInside(absRoot, real)) {
        return { ok: false, reason: 'symlink escapes the project root', path: current };
      }
      current = real;
    }
  }
  let st: Stats;
  try {
    st = lstatSync(current);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return { ok: false, reason: code === 'ENOENT' ? 'path does not exist' : (code ?? 'cannot stat'), path: current };
  }
  return { ok: true, realPath: canonicalize(current), stat: st, viaSymlink };
}

export function assertContained(root: string, target: string): Extract<ContainmentVerdict, { ok: true }> {
  const v = inspectContained(root, target);
  if (!v.ok) throw new ContainmentError(root, v.path, v.reason);
  return v;
}

export interface BoundedRead {
  readonly path: string;
  readonly realPath: string;
  readonly bytes: Buffer;
  readonly truncated: boolean;
  readonly viaSymlink: boolean;
  readonly size: number;
}

/**
 * Read at most `cap` bytes from a contained path. Opens the final hop with
 * O_NOFOLLOW when it is a regular file. A symlink final hop is read only
 * after inspectContained has accepted its target; the open then uses the
 * contained real path with O_NOFOLLOW.
 */
export function readContainedFile(root: string, target: string, cap: number): BoundedRead | null {
  const v = inspectContained(root, target);
  if (!v.ok) {
    if (v.reason === 'path does not exist' || v.reason === 'symlink target does not exist') return null;
    throw new ContainmentError(root, v.path, v.reason);
  }
  const openPath = v.realPath;
  const follow = inspectContained(root, openPath);
  if (!follow.ok) throw new ContainmentError(root, follow.path, follow.reason);
  if (!follow.stat.isFile() && !v.stat.isFile()) {
    const fileFollow = follow.stat.isDirectory() ? follow : v;
    if (!fileFollow.stat.isFile()) throw new ContainmentError(root, openPath, 'is not a regular file');
  }
  const filePath = follow.stat.isFile() ? follow.realPath : v.realPath;
  let fd: number;
  try {
    fd = openSync(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return null;
    if (code === 'ELOOP') throw new ContainmentError(root, filePath, 'is a symbolic link');
    throw error;
  }
  try {
    const size = follow.stat.isFile() ? follow.stat.size : v.stat.size;
    const want = Math.min(cap, Number.isFinite(size) && size >= 0 ? size : cap);
    const buf = Buffer.alloc(want);
    const n = readSync(fd, buf, 0, want, 0);
    const bytes = n === want ? buf : buf.subarray(0, n);
    return {
      path: relative(normalizeRoot(root), resolve(root, target)).split(sep).join('/') || '.',
      realPath: filePath,
      bytes,
      truncated: size > cap,
      viaSymlink: v.viaSymlink,
      size,
    };
  } finally {
    closeSync(fd);
  }
}

/** Parent directory of `file`, for callers that write a sibling temp then rename. */
export function containedDir(root: string, file: string): string {
  return dirname(assertContained(root, file).realPath);
}
