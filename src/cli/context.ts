/**
 * cli/context.ts — what every command needs before it acts: where it runs,
 * which project that is, a clock, an id source, and the per-user paths. The
 * CLI is an adapter, so this is where env, cwd, and randomness are read;
 * the kernel receives them.
 */

import { randomUUID } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { resolvePaths, type Paths } from '../kernel/paths.ts';
import { findProjectRoot, hasProject, NoProjectError } from '../kernel/project/discover.ts';
import { projectLayout, type ProjectLayout } from '../kernel/project/layout.ts';
import { readProjectFiles } from '../kernel/project/initialize.ts';
import { readJsonFile } from '../kernel/project/files.ts';
import { validateUserDefaults, userDefaultsPath, type ResolveConfigInput } from '../kernel/project/config.ts';
import { openStateStore, type StateStore } from '../kernel/state/open.ts';
import { StateBusyError, UnsupportedStateError } from '../kernel/state/format.ts';
import { OperationError } from './output.ts';
import type { TerminalFacts } from './person-channel.ts';

export interface CliContext {
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly paths: Paths;
  /** Set for commands declared read-only: the state database is opened without write access. */
  readonly readOnly?: boolean;
  /** How long opening the state database waits for another process's lock; the store's default when unset. */
  readonly stateBusyTimeoutMs?: number;
  /**
   * Where the session actually runs, when `cwd` was set to a project root on
   * its behalf (`serve --project`). Used only to tell which git worktree the
   * session works in; the project and its store still come from `cwd`.
   */
  readonly sessionCwd?: string;
  /**
   * What the terminal looks like, supplied only by tests. Production reads it
   * from the process itself; a subprocess cannot set this.
   */
  readonly terminal?: TerminalFacts;
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

/** A checkout and, when it is a linked git worktree, the main checkout it belongs to. */
export interface Repository {
  /** The directory holding this checkout's `.git` entry. */
  readonly checkout: string;
  /** The main checkout: equal to `checkout` unless this is a linked worktree. */
  readonly mainRoot: string;
  /** True when `.git` is a file pointing at a linked worktree's git directory. */
  readonly linked: boolean;
  readonly branch: string | null;
  readonly head: string | null;
}

function readTrimmed(path: string): string | null {
  try {
    return readFileSync(path, 'utf8').trim();
  } catch {
    return null;
  }
}

function headOf(gitDir: string): { branch: string | null; head: string | null } {
  const head = readTrimmed(join(gitDir, 'HEAD'));
  if (!head) return { branch: null, head: null };
  const ref = /^ref:\s*refs\/heads\/(.+)$/.exec(head);
  return ref ? { branch: ref[1]!, head: null } : { branch: null, head };
}

/**
 * The repository a directory belongs to, read from files alone (no git process,
 * so hooks stay fast). A linked worktree's `.git` is a file naming its git
 * directory, whose `commondir` names the main repository's `.git`; the main
 * checkout is that directory's parent. A bare repository has no main checkout
 * and is reported as its own, unlinked.
 */
export function resolveRepository(cwd: string): Repository | null {
  const checkout = gitRootOf(cwd);
  if (checkout === null) return null;
  const dotGit = join(checkout, '.git');
  let gitDir = dotGit;
  let linked = false;
  if (lstatSync(dotGit).isFile()) {
    const pointer = /^gitdir:\s*(.+)$/m.exec(readTrimmed(dotGit) ?? '');
    if (pointer) {
      gitDir = resolve(checkout, pointer[1]!);
      const common = readTrimmed(join(gitDir, 'commondir'));
      const commonDir = common ? resolve(gitDir, common) : null;
      if (commonDir && basename(commonDir) === '.git' && existsSync(commonDir)) {
        const { branch, head } = headOf(gitDir);
        return { checkout, mainRoot: dirname(commonDir), linked: true, branch, head };
      }
    }
  }
  const { branch, head } = headOf(gitDir);
  return { checkout, mainRoot: checkout, linked, branch, head };
}

/** Where init would put a project: the repository root, else cwd itself. */
export function initRootFor(cwd: string): string {
  return gitRootOf(cwd) ?? resolve(cwd);
}

/** The git worktree a session works in, when it is not the project's main checkout. */
export interface Lane {
  /** The project's directory inside this worktree: where its files are read. */
  readonly root: string;
  readonly checkout: string;
  readonly branch: string | null;
  readonly head: string | null;
}

export interface BoundProject {
  /** The project's directory in the main checkout: its configuration and its one store live here. */
  readonly root: string;
  readonly layout: ProjectLayout;
  readonly files: ReturnType<typeof readProjectFiles>;
  /** Set when the session works in a linked worktree of the project's repository. */
  readonly lane: Lane | null;
}

/** A linked worktree cannot be bound because the project it belongs to cannot be settled. */
export class WorktreeBindingError extends OperationError {
  constructor(message: string, next: string) {
    super(message, next);
    this.name = 'WorktreeBindingError';
  }
}

/** The lane a session in `sessionCwd` works in, when that is a linked worktree of the repository holding `root`. */
function laneFor(root: string, sessionCwd: string): Lane | null {
  const repo = resolveRepository(sessionCwd);
  if (!repo?.linked) return null;
  // Git records worktree paths resolved; compare real paths so an aliased
  // spelling of the same directory (macOS /var and /private/var) still matches.
  const rel = relative(realpathOr(repo.mainRoot), realpathOr(root));
  if (rel.startsWith('..') || isAbsolute(rel)) return null;
  return { root: join(repo.checkout, rel), checkout: repo.checkout, branch: repo.branch, head: repo.head };
}

function realpathOr(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

/**
 * Bind to the project this directory belongs to, never crossing a repository.
 * In a linked git worktree the project is the one in the main checkout: its
 * configuration and its single store are read there, and the worktree becomes
 * the session's lane. The worktree never gets a store of its own.
 */
export function bindProject(ctx: CliContext): BoundProject {
  const repo = resolveRepository(ctx.cwd);
  const floor = repo?.checkout ?? ctx.cwd;
  const here = findProjectRoot({ start: ctx.cwd, floor });
  if (!repo?.linked) {
    if (here === null) throw new NoProjectError(resolve(ctx.cwd));
    return { root: here, layout: projectLayout(here), files: readProjectFiles(here), lane: laneFor(here, ctx.sessionCwd ?? ctx.cwd) };
  }
  const sameRelative = (dir: string): string => join(repo.mainRoot, relative(repo.checkout, dir));
  const root = here !== null ? sameRelative(here) : findProjectRoot({ start: sameRelative(ctx.cwd), floor: repo.mainRoot });
  if (root === null || !hasProject(root)) {
    throw new WorktreeBindingError(
      `this is a git worktree of ${repo.mainRoot}, and that checkout has no Construct project${here !== null ? ` at ${sameRelative(here)}` : ''}`,
      `Run \`construct init\` in ${repo.mainRoot}; its one store serves every worktree of the repository.`,
    );
  }
  const files = readProjectFiles(root);
  const laneFiles = here !== null ? readProjectFiles(here) : null;
  const mainId = files.config?.id ?? null;
  const laneId = laneFiles?.config?.id ?? null;
  if (laneId !== null && mainId !== null && laneId !== mainId) {
    throw new WorktreeBindingError(
      `this worktree's .construct/project.json names project ${laneId}, but the main checkout's names ${mainId}`,
      'One repository is one project. Bring the worktree’s .construct/project.json back in line with the main checkout’s.',
    );
  }
  const lane: Lane = { root: join(repo.checkout, relative(repo.mainRoot, root)), checkout: repo.checkout, branch: repo.branch, head: repo.head };
  return { root, layout: projectLayout(root), files, lane };
}

/** The project exists and its store is intact, but another process held the write lock past every wait. */
export class ProjectBusyError extends OperationError {
  constructor(message: string) {
    super(message, 'Try again in a moment. The database is intact; another session is mid-write.');
    this.name = 'ProjectBusyError';
  }
}

export interface OpenProject extends BoundProject {
  readonly store: StateStore;
}

/**
 * Bind and open the state database. A read-only command opens it without
 * write access, so inspecting a project never changes its format. A foreign
 * format is refused with the reset instruction; an older one with the migrate
 * instruction; a newer one with the upgrade instruction; a busy one with a
 * retry, never with an instruction that would discard state.
 */
export function openProject(ctx: CliContext): OpenProject {
  const bound = bindProject(ctx);
  if (!existsSync(bound.layout.dbPath)) {
    throw new OperationError(
      `this project has no state database at ${bound.layout.dbPath}`,
      'Run `construct init` to create it.',
    );
  }
  try {
    const store = openStateStore(bound.layout.dbPath, { readOnly: ctx.readOnly === true, busyTimeoutMs: ctx.stateBusyTimeoutMs });
    return { ...bound, store };
  } catch (error) {
    if (error instanceof UnsupportedStateError) throw error;
    if (error instanceof StateBusyError) throw new ProjectBusyError(error.message);
    throw new OperationError(`cannot open the state database at ${bound.layout.dbPath}: ${(error as Error).message}`, 'Check the file’s permissions and that this user owns it.');
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
