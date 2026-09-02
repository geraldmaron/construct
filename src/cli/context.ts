/**
 * cli/context.ts — what every command needs before it acts: where it runs,
 * which project that is, a clock, an id source, and the per-user paths. The
 * CLI is an adapter, so this is where env, cwd, and randomness are read;
 * the kernel receives them.
 */

import { randomUUID } from 'node:crypto';
import { lstatSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { resolvePaths, type Paths } from '../kernel/paths.ts';
import { findProjectRoot, NoProjectError } from '../kernel/project/discover.ts';
import { projectLayout, type ProjectLayout } from '../kernel/project/layout.ts';
import { readProjectFiles } from '../kernel/project/initialize.ts';
import { readJsonFile } from '../kernel/project/files.ts';
import { validateUserDefaults, userDefaultsPath, type ResolveConfigInput } from '../kernel/project/config.ts';
import { openStateStore, type StateStore } from '../kernel/state/open.ts';
import { UnsupportedStateError } from '../kernel/state/format.ts';
import { OperationError } from './output.ts';

export interface CliContext {
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly paths: Paths;
  now(): string;
  nextId(prefix: string): string;
}

export function createContext(cwd: string = process.cwd(), env: NodeJS.ProcessEnv = process.env): CliContext {
  return {
    cwd,
    env,
    paths: resolvePaths(env),
    now: () => new Date().toISOString(),
    nextId: (prefix) => `${prefix}-${randomUUID().slice(0, 8)}`,
  };
}

/** The nearest directory at or above cwd holding a .git entry, or null. */
export function gitRootOf(cwd: string): string | null {
  let dir = resolve(cwd);
  for (;;) {
    try {
      lstatSync(join(dir, '.git'));
      return dir;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** Where init would put a project: the repository root, else cwd itself. */
export function initRootFor(cwd: string): string {
  return gitRootOf(cwd) ?? resolve(cwd);
}

export interface BoundProject {
  readonly root: string;
  readonly layout: ProjectLayout;
  readonly files: ReturnType<typeof readProjectFiles>;
}

/** Bind to the project this directory belongs to, never crossing a repository. */
export function bindProject(ctx: CliContext): BoundProject {
  const floor = gitRootOf(ctx.cwd) ?? ctx.cwd;
  const root = findProjectRoot({ start: ctx.cwd, floor });
  if (root === null) throw new NoProjectError(resolve(ctx.cwd));
  return { root, layout: projectLayout(root), files: readProjectFiles(root) };
}

export interface OpenProject extends BoundProject {
  readonly store: StateStore;
}

/** Bind and open the state database. Refuses foreign formats with the reset instruction. */
export function openProject(ctx: CliContext): OpenProject {
  const bound = bindProject(ctx);
  if (!existsSync(bound.layout.dbPath)) {
    throw new OperationError(
      `this project has no state database at ${bound.layout.dbPath}`,
      'Run `construct init` to create it.',
    );
  }
  try {
    const store = openStateStore(bound.layout.dbPath);
    return { ...bound, store };
  } catch (error) {
    if (error instanceof UnsupportedStateError) throw error;
    throw new OperationError(`cannot open the state database at ${bound.layout.dbPath}: ${(error as Error).message}`, 'Check the file’s permissions, or run `construct reset` to see what would be replaced.');
  }
}

export function withProject<T>(ctx: CliContext, fn: (project: OpenProject) => T): T {
  const project = openProject(ctx);
  try {
    return fn(project);
  } finally {
    project.store.close();
  }
}

/** The inputs config resolution needs for this invocation. */
export function configInputs(ctx: CliContext, bound: BoundProject | null, flags: Readonly<Record<string, string>>): ResolveConfigInput {
  const userPath = userDefaultsPath(ctx.paths);
  const user = readJsonFile(ctx.paths.configDir, userPath, validateUserDefaults);
  return {
    userDefaults: user ? { path: userPath, values: user.values } : null,
    projectConfig: bound?.files.config ? { path: bound.layout.projectFile, behavior: bound.files.config.behavior } : null,
    env: ctx.env,
    flags,
  };
}
