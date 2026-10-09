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

import { realpathSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

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
    const why = valid === null
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
