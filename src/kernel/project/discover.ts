/**
 * kernel/project/discover.ts — find the project a working directory belongs to.
 *
 * The walk goes up from `start` and stops at `floor` (the repository root the
 * caller found, or `start` itself when there is none). It never climbs past
 * the floor, so a nested checkout never binds to an outer one and a directory
 * outside any repository binds only to itself.
 */

import { lstatSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { projectFilePath } from './layout.ts';

export interface FindProjectRootInput {
  readonly start: string;
  /** Highest directory the walk may reach. Defaults to `start`. */
  readonly floor?: string;
}

function isRegularFile(path: string): boolean {
  try {
    return lstatSync(path).isFile();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

function within(child: string, parent: string): boolean {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !resolve(parent, rel).startsWith('..'));
}

export function hasProject(root: string): boolean {
  return isRegularFile(projectFilePath(root));
}

/** The nearest directory at or above `start` carrying `.construct/project.json`, bounded by `floor`. */
export function findProjectRoot(input: FindProjectRootInput): string | null {
  const start = resolve(input.start);
  const floor = resolve(input.floor ?? start);
  if (!within(start, floor)) return hasProject(start) ? start : null;
  let dir = start;
  for (;;) {
    if (hasProject(dir)) return dir;
    if (dir === floor) return null;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export class NoProjectError extends Error {
  readonly searched: string;

  constructor(searched: string) {
    super(
      `No Construct project here (looked from ${searched} up to the repository root).\n` +
        'Run `construct init` in the project to set one up. Construct does managed work only inside a project.',
    );
    this.name = 'NoProjectError';
    this.searched = searched;
  }
}

/** Like findProjectRoot, but a missing project is an error the CLI can print. */
export function requireProjectRoot(input: FindProjectRootInput): string {
  const root = findProjectRoot(input);
  if (root === null) throw new NoProjectError(resolve(input.start));
  return root;
}
