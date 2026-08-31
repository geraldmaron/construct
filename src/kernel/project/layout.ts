/**
 * kernel/project/layout.ts — project-local Construct paths.
 *
 * Configuration (declarative, may be committed) and runtime state (ignored by
 * Git) are separate directories under `.construct/`. The kernel receives a
 * resolved project root; this module never walks the filesystem for `.git`.
 */

import { join } from 'node:path';

export const PROJECT_DIR_NAME = '.construct';
export const PROJECT_CONFIG_NAME = 'project.json';
export const PROJECT_STATE_DIR_NAME = 'state';
export const PROJECT_DB_NAME = 'construct.sqlite';

/** `.construct` under a resolved project root. */
export function projectDir(projectRoot: string): string {
  return join(projectRoot, PROJECT_DIR_NAME);
}

/** Declarative project config path. */
export function projectConfigPath(projectRoot: string): string {
  return join(projectDir(projectRoot), PROJECT_CONFIG_NAME);
}

/** Runtime state directory (sqlite and friends). Must be gitignored. */
export function projectStateDir(projectRoot: string): string {
  return join(projectDir(projectRoot), PROJECT_STATE_DIR_NAME);
}

/** Project-local sqlite database path. */
export function projectDbPath(projectRoot: string): string {
  return join(projectStateDir(projectRoot), PROJECT_DB_NAME);
}
