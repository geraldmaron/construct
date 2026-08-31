/**
 * kernel/project/initialize.ts — create project-local Construct config + v1 state.
 *
 * Safe to call repeatedly (reconcile). Does not migrate old alpha stores: if a
 * legacy sqlite is present at the project db path, open throws and the caller
 * must reset.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { openStateStore, type StateStore } from '../state/open.ts';
import type { ProjectContext } from './context.ts';
import {
  projectConfigPath,
  projectDbPath,
  projectDir,
  projectStateDir,
  PROJECT_STATE_DIR_NAME,
  PROJECT_DIR_NAME,
} from './layout.ts';

export const PROJECT_CONFIG_FORMAT = 'construct-project';
export const PROJECT_CONFIG_VERSION = 1;

/** Ignore pattern covering runtime state (not declarative project.json). */
export const STATE_GITIGNORE_PATTERN = `${PROJECT_DIR_NAME}/${PROJECT_STATE_DIR_NAME}/`;

export interface ProjectConfig {
  readonly format: typeof PROJECT_CONFIG_FORMAT;
  readonly formatVersion: typeof PROJECT_CONFIG_VERSION;
  readonly integrations: Record<string, { readonly status: 'installed' | 'absent' }>;
}

export interface InitializeProjectResult {
  readonly root: string;
  readonly configPath: string;
  readonly stateDir: string;
  readonly dbPath: string;
  readonly createdConfig: boolean;
  readonly createdState: boolean;
  readonly ensuredGitignore: boolean;
  readonly store: StateStore;
}

function defaultConfig(): ProjectConfig {
  return {
    format: PROJECT_CONFIG_FORMAT,
    formatVersion: PROJECT_CONFIG_VERSION,
    integrations: {},
  };
}

function ensureGitignore(projectRoot: string): boolean {
  const gi = join(projectRoot, '.gitignore');
  if (!existsSync(gi)) {
    writeFileSync(gi, `${STATE_GITIGNORE_PATTERN}\n`, 'utf8');
    return true;
  }
  const text = readFileSync(gi, 'utf8');
  const lines = text.split(/\r?\n/);
  const covered = lines.some(
    (line) =>
      line.trim() === STATE_GITIGNORE_PATTERN ||
      line.trim() === STATE_GITIGNORE_PATTERN.slice(0, -1) ||
      line.trim() === `${PROJECT_DIR_NAME}/` ||
      line.trim() === `${PROJECT_DIR_NAME}/**`,
  );
  if (covered) return false;
  const prefix = text.length === 0 || text.endsWith('\n') ? '' : '\n';
  appendFileSync(gi, `${prefix}# Construct runtime state\n${STATE_GITIGNORE_PATTERN}\n`, 'utf8');
  return true;
}

/**
 * Ensure `.construct/project.json`, ignored state dir, and a v1 sqlite store.
 */
export function initializeProject(ctx: ProjectContext): InitializeProjectResult {
  const root = ctx.root;
  mkdirSync(projectDir(root), { recursive: true });
  mkdirSync(projectStateDir(root), { recursive: true });

  const configPath = projectConfigPath(root);
  let createdConfig = false;
  if (!existsSync(configPath)) {
    writeFileSync(configPath, `${JSON.stringify(defaultConfig(), null, 2)}\n`, 'utf8');
    createdConfig = true;
  }

  const dbPath = projectDbPath(root);
  const createdState = !existsSync(dbPath);
  const ensuredGitignore = ensureGitignore(root);
  const store = openStateStore(dbPath);

  return {
    root,
    configPath,
    stateDir: projectStateDir(root),
    dbPath,
    createdConfig,
    createdState,
    ensuredGitignore,
    store,
  };
}
