/**
 * kernel/project/layout.ts — where a project's Construct files live.
 *
 * Everything under `.construct/` is committed except `state/`, which holds the
 * one runtime database and is ignored by Git. The kernel receives a resolved
 * project root; nothing here walks the filesystem.
 */

import { join } from 'node:path';

export const PROJECT_DIR_NAME = '.construct';
export const PROJECT_FILE_NAME = 'project.json';
export const CONSTITUTION_FILE_NAME = 'constitution.json';
export const SOURCES_FILE_NAME = 'sources.json';
export const LOCK_FILE_NAME = 'registry.lock.json';
export const PROJECT_SKILLS_DIR_NAME = 'skills';
export const PROJECT_WORKFLOWS_DIR_NAME = 'workflows';
export const PROJECT_STATE_DIR_NAME = 'state';
export const PROJECT_DB_NAME = 'construct.sqlite';

/** The ignore pattern that keeps runtime state out of Git. */
export const STATE_GITIGNORE_PATTERN = `${PROJECT_DIR_NAME}/${PROJECT_STATE_DIR_NAME}/`;

export interface ProjectLayout {
  readonly root: string;
  readonly dir: string;
  readonly projectFile: string;
  readonly constitutionFile: string;
  readonly sourcesFile: string;
  readonly lockFile: string;
  readonly skillsDir: string;
  readonly workflowsDir: string;
  readonly stateDir: string;
  readonly dbPath: string;
}

export function projectDir(root: string): string {
  return join(root, PROJECT_DIR_NAME);
}
export function projectFilePath(root: string): string {
  return join(projectDir(root), PROJECT_FILE_NAME);
}
export function constitutionPath(root: string): string {
  return join(projectDir(root), CONSTITUTION_FILE_NAME);
}
export function sourcesPath(root: string): string {
  return join(projectDir(root), SOURCES_FILE_NAME);
}
export function lockfilePath(root: string): string {
  return join(projectDir(root), LOCK_FILE_NAME);
}
export function projectSkillsDir(root: string): string {
  return join(projectDir(root), PROJECT_SKILLS_DIR_NAME);
}
export function projectWorkflowsDir(root: string): string {
  return join(projectDir(root), PROJECT_WORKFLOWS_DIR_NAME);
}
export function projectStateDir(root: string): string {
  return join(projectDir(root), PROJECT_STATE_DIR_NAME);
}
export function projectDbPath(root: string): string {
  return join(projectStateDir(root), PROJECT_DB_NAME);
}

export function projectLayout(root: string): ProjectLayout {
  return {
    root,
    dir: projectDir(root),
    projectFile: projectFilePath(root),
    constitutionFile: constitutionPath(root),
    sourcesFile: sourcesPath(root),
    lockFile: lockfilePath(root),
    skillsDir: projectSkillsDir(root),
    workflowsDir: projectWorkflowsDir(root),
    stateDir: projectStateDir(root),
    dbPath: projectDbPath(root),
  };
}
