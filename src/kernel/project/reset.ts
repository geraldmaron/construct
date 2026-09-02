/**
 * kernel/project/reset.ts — remove exactly the Construct-owned files a person
 * confirmed, and nothing else.
 *
 * `planReset` names every target with what it is. `applyReset` refuses unless
 * the caller passes back exactly the paths from a plan, so a confirmation is
 * always of a specific list, never "everything".
 */

import { existsSync, rmSync } from 'node:fs';
import type { Paths } from '../paths.ts';
import { detectLegacyHomeState, detectLegacyProjectFiles, type LegacyTarget } from './legacy.ts';
import { projectDbPath, projectLayout } from './layout.ts';

export interface ResetPlan {
  readonly root: string;
  readonly targets: readonly LegacyTarget[];
}

export interface PlanResetOptions {
  /** Also remove the committed project files, not only runtime state. */
  readonly includeProjectFiles?: boolean;
  /** Also name old per-user databases, when the caller can resolve them. */
  readonly paths?: Paths;
}

export function planReset(root: string, options: PlanResetOptions = {}): ResetPlan {
  const layout = projectLayout(root);
  const targets: LegacyTarget[] = [];
  if (existsSync(layout.dbPath)) targets.push({ path: layout.dbPath, what: 'this project’s runtime state database' });
  for (const legacy of detectLegacyProjectFiles(root)) targets.push(legacy);
  if (options.includeProjectFiles) {
    for (const [path, what] of [
      [layout.projectFile, 'the project config'],
      [layout.constitutionFile, 'the project constitution'],
      [layout.sourcesFile, 'the source declarations'],
      [layout.lockFile, 'the registry lockfile'],
    ] as const) {
      if (existsSync(path) && !targets.some((t) => t.path === path)) targets.push({ path, what });
    }
  }
  if (options.paths) for (const legacy of detectLegacyHomeState(options.paths)) targets.push(legacy);
  return { root, targets };
}

export class ResetNotConfirmedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ResetNotConfirmedError';
  }
}

/** Remove the confirmed paths. Every confirmed path must be in the plan. */
export function applyReset(plan: ResetPlan, confirmedPaths: readonly string[]): readonly string[] {
  if (confirmedPaths.length === 0) {
    throw new ResetNotConfirmedError('reset removes nothing until the exact targets are confirmed');
  }
  const planned = new Set(plan.targets.map((t) => t.path));
  const stray = confirmedPaths.filter((p) => !planned.has(p));
  if (stray.length > 0) {
    throw new ResetNotConfirmedError(`refusing to remove paths the plan did not name: ${stray.join(', ')}`);
  }
  const removed: string[] = [];
  for (const path of confirmedPaths) {
    if (existsSync(path)) {
      rmSync(path, { force: true });
      removed.push(path);
    }
  }
  return removed;
}

export function stateDbExists(root: string): boolean {
  return existsSync(projectDbPath(root));
}
