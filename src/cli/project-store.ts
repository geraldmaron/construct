/**
 * cli/project-store.ts — open format-v1 project state from the CLI.
 *
 * Product surfaces that speak StaffMember / Routine / Decision use this path.
 * Legacy verbs keep withStore() → home/schema-23 store until Phase G deletes them.
 */

import { existsSync } from 'node:fs';
import { openStateStore, type StateStore } from '../kernel/state/open.ts';
import { resolveProjectContext } from '../kernel/project/context.ts';
import { projectConfigPath, projectDbPath } from '../kernel/project/layout.ts';
import { gitRoot } from './settings-file.ts';

export function projectRootForCwd(cwd: string = process.cwd()): string {
  return resolveProjectContext({
    gitRoot: gitRoot(cwd) ?? undefined,
    cwd,
    allowCwdFallback: true,
  }).root;
}

export function projectHasV1State(projectRoot: string): boolean {
  return existsSync(projectConfigPath(projectRoot)) && existsSync(projectDbPath(projectRoot));
}

export function tryOpenProjectStore(cwd: string = process.cwd()): {
  readonly root: string;
  readonly store: StateStore;
} | null {
  const root = projectRootForCwd(cwd);
  if (!projectHasV1State(root)) return null;
  return { root, store: openStateStore(projectDbPath(root)) };
}

export function withProjectStore<T>(
  cwd: string,
  fn: (store: StateStore, root: string) => T,
): T | null {
  const opened = tryOpenProjectStore(cwd);
  if (!opened) return null;
  try {
    return fn(opened.store, opened.root);
  } finally {
    opened.store.close();
  }
}
