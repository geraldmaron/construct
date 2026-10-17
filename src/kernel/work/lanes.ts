/**
 * kernel/work/lanes.ts — the checkout a claimant names as where it edits.
 *
 * A claim's reservations record the checkout its edits happen in, so that two
 * writers in one checkout collide and writers in different worktrees see a
 * merge risk. By default that is the checkout the session runs in. An agent
 * that edits in another git worktree of the project names it, and the claim
 * records that worktree and the branch it has checked out instead.
 *
 * A name is honored only when it is one of the project's worktrees as the
 * adapter reads them from the repository; anything else is refused with the
 * names that would be. The kernel never asks git itself.
 */

import { lstatSync, realpathSync, readdirSync, statSync, type Dirent } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { symlinkBetween } from '../project/files.ts';
import { listLiveLeases, MAIN_LANE, normalizeLeasePath, pathsOverlap } from './leases.ts';
import type { StateStore } from '../state/open.ts';

/** Lexical reservations cannot coordinate filesystem aliases. Refuse them,
 * including existing reservations whose ancestry changed since acquisition.
 * Release/reconcile such a reservation before taking another write claim. */
export function assertLeasePaths(input: { root: string; lane?: string; paths: readonly string[]; store: StateStore; now: string }): void {
  const root = input.lane ?? input.root;
  const held = listLiveLeases(input.store, input.now).filter((l) => l.laneRoot === (input.lane ?? MAIN_LANE));
  for (const raw of new Set([...input.paths, ...held.map((l) => l.path)])) assertUnaliasedPath(root, raw);
  // Missing leaves have no canonical filesystem spelling yet. Treat possible
  // case/Unicode aliases conservatively unless existing distinct ancestors
  // prove they are separate objects (as on a case-sensitive filesystem).
  const fold = (p: string) => p.normalize('NFD').toUpperCase();
  for (const raw of input.paths) {
    const path = normalizeLeasePath(raw, 'check');
    for (const lease of held) {
      if (pathsOverlap(path, lease.path) || !pathsOverlap(fold(path), fold(lease.path))) continue;
      const a = path.split('/').filter(Boolean),
        b = lease.path.split('/').filter(Boolean);
      let separate = false;
      for (let n = 1; n <= Math.min(a.length, b.length); n++) {
        try {
          const left = statSync(resolve(root, ...a.slice(0, n))),
            right = statSync(resolve(root, ...b.slice(0, n)));
          if (left.dev !== right.dev || left.ino !== right.ino) {
            separate = true;
            break;
          }
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
          break;
        }
      }
      if (!separate)
        throw new Error(
          `Cannot coordinate ${JSON.stringify(path)}: a possible case or Unicode filename alias is reserved as ${JSON.stringify(lease.path)} by ${lease.workId}. Use the same canonical spelling or reconcile that reservation.`,
        );
    }
  }
}

/** Refuse unsupported physical aliases without changing persisted path syntax. */
export function assertUnaliasedPath(root: string, raw: string): void {
  const path = normalizeLeasePath(raw, 'check');
  const base = realpathSync.native(root);
  const target = path === '/' ? base : resolve(base, path);
  if (symlinkBetween(base, target))
    throw new Error(
      `Cannot coordinate ${JSON.stringify(path)} through a symbolic link. Use its canonical repository path; release or reconcile any existing alias reservation before continuing.`,
    );
  let current = target;
  for (;;) {
    try {
      const stat = lstatSync(current);
      if (stat.isFile() && stat.nlink > 1)
        throw new Error(
          `Cannot coordinate ${JSON.stringify(path)}: multiple hard links share its bytes. Use an independent file or reconcile its aliases before claiming it.`,
        );
      if (realpathSync.native(current) !== current)
        throw new Error(
          `Cannot coordinate ${JSON.stringify(path)}: use the canonical filesystem spelling, including case and Unicode form.`,
        );
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const parent = dirname(current);
      if (parent === current) throw error;
      current = parent;
    }
  }
  // Root-wide scopes already exclude every other writer. Narrow directories
  // must not conceal links to files outside their lexical reservation.
  if (path === '/' || !path.endsWith('/')) return;
  const visit = (directory: string): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries) {
      const file = join(directory, entry.name),
        stat = lstatSync(file);
      if (stat.isSymbolicLink() || (stat.isFile() && stat.nlink > 1))
        throw new Error(
          `Cannot coordinate directory ${JSON.stringify(path)} because it contains symbolic or hard links. Name independent canonical files, reserve the repository root exclusively, or reconcile the aliases.`,
        );
      if (stat.isDirectory()) visit(file);
    }
  };
  visit(target);
}

/** One checkout of the project's repository, as the adapter reads it. */
export interface ProjectWorktree {
  /** The project's directory in this checkout: what a session working there records as its lane. */
  readonly root: string;
  /** The checkout's top directory. */
  readonly checkout: string;
  /** The branch checked out there; null when its HEAD is detached. */
  readonly branch: string | null;
  readonly head: string | null;
  /** True for the main checkout, whose reservations are recorded under the main lane. */
  readonly main: boolean;
}

/** Where a claimant edits: a worktree's lane, or the main checkout (no lane), and the branch there. */
export interface EditLane {
  readonly lane?: string;
  readonly branch: string | null;
}

/** The longest worktree path a claim may name, in characters. */
export const WORKTREE_PATH_MAX = 4096;

/** A named worktree that is not one of the project's, with the ones that are. */
export class UnknownWorktreeError extends Error {
  readonly named: string;
  readonly valid: readonly ProjectWorktree[];

  /** `valid` is null when the caller cannot read the project's worktrees at all. */
  constructor(named: string, valid: readonly ProjectWorktree[] | null) {
    const shown = JSON.stringify(named.length > 200 ? `${named.slice(0, 200)}…` : named);
    const why =
      valid === null
        ? 'this caller cannot read the project\'s worktrees; leave "worktree" out'
        : valid.length === 0
          ? 'this project is in no git repository Construct can read, so it has no worktrees to name; leave "worktree" out'
          : `name one of: ${valid.map(describe).join('; ')}`;
    super(`${shown} is not a git worktree of this project; ${why}`);
    this.name = 'UnknownWorktreeError';
    this.named = named;
    this.valid = valid ?? [];
  }
}

function describe(w: ProjectWorktree): string {
  const what = w.main ? 'the main checkout' : 'a worktree';
  return `${w.checkout} (${what}${w.branch ? `, on ${w.branch}` : ', detached'})`;
}

/** A path as the file system resolves it, so an aliased spelling names the same directory. */
function canonical(path: string): string {
  const plain = resolve(path);
  try {
    return realpathSync(plain);
  } catch {
    return plain;
  }
}

/**
 * The lane a claim records when it names `named` as the worktree it edits in.
 * `named` is an absolute path to a worktree's top directory or to the project's
 * directory inside it. `worktrees` is the project's checkouts as the adapter
 * read them, null when the caller cannot read them; `here` is the worktree the
 * session itself runs in, whose recorded spelling is kept when it is the one
 * named, so the session's own claims and the named ones compare as one lane.
 */
export function laneNamed(input: {
  readonly named: string;
  readonly worktrees: readonly ProjectWorktree[] | null;
  readonly here: { readonly root: string; readonly checkout: string } | null;
}): EditLane {
  const worktrees = input.worktrees;
  if (worktrees === null || !isAbsolute(input.named)) throw new UnknownWorktreeError(input.named, worktrees);
  const wanted = canonical(input.named);
  const match = worktrees.find((w) => canonical(w.checkout) === wanted || canonical(w.root) === wanted);
  if (!match) throw new UnknownWorktreeError(input.named, worktrees);
  if (match.main) return { branch: match.branch };
  const sameAsHere = input.here !== null && canonical(input.here.checkout) === canonical(match.checkout);
  return { lane: sameAsHere ? input.here!.root : match.root, branch: match.branch };
}
