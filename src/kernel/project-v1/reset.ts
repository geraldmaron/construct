/**
 * kernel/project-v1/reset.ts — wipe project runtime state and re-init format v1.
 *
 * Does not interpret or migrate old bytes. Removes the sqlite file (and only
 * that) then calls initializeProject. Declarative project.json is preserved
 * unless `wipeConfig` is set.
 */

import { existsSync, rmSync } from 'node:fs';
import type { ProjectContext } from './context.ts';
import { projectConfigPath, projectDbPath } from './layout.ts';
import { initializeProject, type InitializeProjectResult } from './initialize.ts';

export interface ResetProjectOptions {
  readonly wipeConfig?: boolean;
}

/**
 * Delete unsupported or unwanted runtime state and create a clean v1 store.
 */
export function resetProject(
  ctx: ProjectContext,
  options: ResetProjectOptions = {},
): InitializeProjectResult {
  const dbPath = projectDbPath(ctx.root);
  if (existsSync(dbPath)) {
    rmSync(dbPath, { force: true });
  }
  if (options.wipeConfig) {
    const configPath = projectConfigPath(ctx.root);
    if (existsSync(configPath)) rmSync(configPath, { force: true });
  }
  return initializeProject(ctx);
}
