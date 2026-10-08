/**
 * cli/context.ts — what every command needs before it acts: where it runs,
 * which project that is, a clock, an id source, and the per-user paths. The
 * CLI is an adapter, so this is where env, cwd, and randomness are read;
 * the kernel receives them.
 */

import { randomUUID } from 'node:crypto';
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { resolvePaths, type Paths } from '../kernel/paths.ts';
import { findProjectRoot, hasProject, NoProjectError } from '../kernel/project/discover.ts';
import { projectDbPath, projectFilePath, projectLayout, type ProjectLayout } from '../kernel/project/layout.ts';
import { readProjectFiles } from '../kernel/project/initialize.ts';
import { readJsonFile } from '../kernel/project/files.ts';
import { validateProjectConfig, validateUserDefaults, userDefaultsPath, type ResolveConfigInput } from '../kernel/project/config.ts';
import { openStateStore, type StateStore } from '../kernel/state/open.ts';
import { StateBusyError, UnsupportedStateError } from '../kernel/state/format.ts';
import { StoreProjectError, bindStoreToProject } from '../kernel/state/identity.ts';
import type { ProjectWorktree } from '../kernel/work/lanes.ts';
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
  /**
   * The main checkout: equal to `checkout` unless this is a linked worktree.
   * Null when there is none to bind to: the repository is bare, or it does
   * not record where its main checkout is.
   */
  readonly mainRoot: string | null;
  /** True when `.git` is a file naming a git directory that shares another repository's common directory. */
  readonly linked: boolean;
  /** The repository's shared git directory (`.git` in an ordinary checkout). */
  readonly commonDir: string;
  /** True when the repository is bare, so no checkout of it is the main one. */
  readonly bare: boolean;
  readonly branch: string | null;
  readonly head: string | null;
}

function readText(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

function readTrimmed(path: string): string | null {
  return readText(path)?.trim() ?? null;
}

/** One git config value: quotes removed, escapes applied, a trailing comment dropped. */
function gitConfigValue(raw: string): string {
  let out = '';
  let quoted = false;
  for (let i = 0; i < raw.length; i += 1) {
    const c = raw[i]!;
    if (c === '"') {
      quoted = !quoted;
    } else if (c === '\\' && i + 1 < raw.length) {
      i += 1;
      const e = raw[i]!;
      out += e === 'n' ? '\n' : e === 't' ? '\t' : e === 'b' ? '\b' : e;
    } else if (!quoted && (c === '#' || c === ';')) {
      break;
    } else {
      out += c;
    }
  }
  return out.trim();
}

function gitConfigBool(value: string | null): boolean | null {
  if (value === null) return true;
  const v = value.toLowerCase();
  if (v === 'true' || v === 'yes' || v === 'on' || v === '1') return true;
  if (v === 'false' || v === 'no' || v === 'off' || v === '0' || v === '') return false;
  return null;
}

/**
 * `core.bare` and `core.worktree` from git config files, read in order so a
 * later file overrides an earlier one. Only these two keys are read; include
 * directives are not followed.
 */
function readCoreConfig(files: readonly string[]): { readonly bare: boolean | null; readonly worktree: string | null } {
  let bare: boolean | null = null;
  let worktree: string | null = null;
  for (const file of files) {
    const text = readText(file);
    if (text === null) continue;
    let section = '';
    for (const raw of text.split(/\r?\n/)) {
      let line = raw.trim();
      const header = /^\[([^\]"\s]+)(\s+"(?:[^"\\]|\\.)*")?\s*\](.*)$/.exec(line);
      if (header) {
        section = header[2] === undefined ? header[1]!.toLowerCase() : '';
        line = header[3]!.trim();
      }
      if (section !== 'core' || line === '' || line.startsWith('#') || line.startsWith(';')) continue;
      const entry = /^([A-Za-z][A-Za-z0-9-]*)\s*(?:=(.*))?$/.exec(line);
      if (!entry) continue;
      const key = entry[1]!.toLowerCase();
      const value = entry[2] === undefined ? null : gitConfigValue(entry[2]);
      if (key === 'bare') bare = gitConfigBool(value);
      else if (key === 'worktree' && value !== null && value !== '') worktree = value;
    }
  }
  return { bare, worktree };
}

const OBJECT_ID = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;

/**
 * The commit a ref names, from a loose ref in the worktree's git directory or
 * the shared one, then from packed-refs. Null for an unborn branch or a ref
 * stored some other way (reftable).
 */
function resolveRef(name: string, gitDir: string, commonDir: string, depth = 0): string | null {
  if (depth > 5 || !name.startsWith('refs/') || name.split('/').some((part) => part === '..' || part === '')) return null;
  for (const dir of gitDir === commonDir ? [gitDir] : [gitDir, commonDir]) {
    const loose = readTrimmed(join(dir, ...name.split('/')));
    if (loose === null) continue;
    const symbolic = /^ref:\s*(\S+)$/.exec(loose);
    if (symbolic) return resolveRef(symbolic[1]!, gitDir, commonDir, depth + 1);
    return OBJECT_ID.test(loose) ? loose : null;
  }
  for (const line of (readText(join(commonDir, 'packed-refs')) ?? '').split(/\r?\n/)) {
    const packed = /^([0-9a-f]+) (\S+)$/.exec(line);
    if (packed && packed[2] === name && OBJECT_ID.test(packed[1]!)) return packed[1]!;
  }
  return null;
}

function headOf(gitDir: string, commonDir: string): { branch: string | null; head: string | null } {
  const head = readTrimmed(join(gitDir, 'HEAD'));
  if (!head) return { branch: null, head: null };
  const ref = /^ref:\s*(\S+)$/.exec(head);
  if (!ref) return { branch: null, head: OBJECT_ID.test(head) ? head : null };
  const name = ref[1]!;
  return { branch: name.startsWith('refs/heads/') ? name.slice('refs/heads/'.length) : null, head: resolveRef(name, gitDir, commonDir) };
}

/**
 * The repository a directory belongs to, read from files alone (no git process,
 * so hooks stay fast). When `.git` is a file naming a git directory that has a
 * `commondir`, the checkout is a linked worktree, whatever the common directory
 * is called. Its main checkout is `core.worktree` from the common config when
 * set (a submodule's), else the common directory's parent when that directory
 * is a non-bare `.git`. A bare repository has no main checkout, and a common
 * directory named otherwise that sets no `core.worktree` (a separate git
 * directory) does not say where its main checkout is; both leave `mainRoot`
 * null. A `.git` file whose git directory has no `commondir` (a submodule, a
 * separate git directory) marks that repository's own main checkout.
 */
export function resolveRepository(cwd: string): Repository | null {
  const checkout = gitRootOf(cwd);
  if (checkout === null) return null;
  const dotGit = join(checkout, '.git');
  let gitDir = dotGit;
  if (lstatSync(dotGit).isFile()) {
    const pointer = /^gitdir:\s*(.+)$/m.exec(readTrimmed(dotGit) ?? '');
    // A relative pointer is relative to where the .git file really is, not to the spelling that reached it.
    if (pointer) gitDir = resolve(realpathOr(checkout), pointer[1]!.trim());
  }
  const common = gitDir === dotGit ? null : readTrimmed(join(gitDir, 'commondir'));
  const commonDir = common ? resolve(gitDir, common) : gitDir;
  const linked = Boolean(common);
  const core = readCoreConfig([join(commonDir, 'config'), join(commonDir, 'config.worktree')]);
  let mainRoot: string | null;
  if (!linked) mainRoot = core.bare === true ? null : checkout;
  else if (core.worktree !== null) mainRoot = resolve(commonDir, core.worktree);
  else if (core.bare === true) mainRoot = null;
  else mainRoot = basename(commonDir) === '.git' ? dirname(commonDir) : null;
  const bare = mainRoot === null && core.bare === true;
  return { checkout, mainRoot, linked, commonDir, bare, ...headOf(gitDir, commonDir) };
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

/** Where a project lives and which lane the session works in, before its configuration is read. */
export interface ProjectLocation {
  /** The project's directory in the main checkout: its configuration and its one store live here. */
  readonly root: string;
  /** Set when the session works in a linked worktree of the project's repository. */
  readonly lane: Lane | null;
}

export interface BoundProject extends ProjectLocation {
  readonly layout: ProjectLayout;
  readonly files: ReturnType<typeof readProjectFiles>;
}

/**
 * A linked worktree cannot do what was asked: the project it belongs to cannot
 * be settled, or the act belongs to the project's main checkout.
 */
export class WorktreeBindingError extends OperationError {
  constructor(message: string, next: string) {
    super(message, next);
    this.name = 'WorktreeBindingError';
  }
}

/**
 * The repository's main checkout, or a refusal naming why there is none. A
 * project keeps its one store in its main checkout, so a bare repository (and
 * a worktree of one) is refused rather than treated as a project of its own.
 */
export function mainCheckoutOf(repo: Repository): string {
  if (repo.mainRoot !== null) return repo.mainRoot;
  if (repo.bare) {
    throw new WorktreeBindingError(
      `${repo.linked ? `this is a git worktree of the bare repository ${repo.commonDir}` : `this directory's git repository, ${repo.commonDir}, is bare`}, which has no main checkout; Construct keeps a project's one store in its main checkout, so it does not work in bare repository layouts`,
      'Use Construct from an ordinary (non-bare) clone of the repository; every worktree of that clone shares its store.',
    );
  }
  throw new WorktreeBindingError(
    `this is a git worktree of ${repo.commonDir}, which does not record where its main checkout is (the directory is not named .git and sets no core.worktree); Construct keeps a project's one store in the main checkout`,
    'Work from the main checkout, or record it there with `git config core.worktree <path of the main checkout>`.',
  );
}

/** The id a project file names, or null when there is no project file. */
function projectIdAt(root: string): string | null {
  return readJsonFile(root, projectFilePath(root), validateProjectConfig)?.id ?? null;
}

/** The id the lane's own project file names, when the main checkout's is gone; an unreadable file names nothing. */
function laneProjectId(laneRoot: string): string | null {
  try {
    return projectIdAt(laneRoot);
  } catch {
    return null;
  }
}

/**
 * One repository is one project: a lane whose project file names a different
 * id than the main checkout's is refused. A lane without a project file, or a
 * main checkout whose file is absent or unreadable (reported when the
 * configuration is read), leaves nothing to compare.
 */
function requireSameProject(root: string, laneRoot: string): void {
  const laneId = projectIdAt(laneRoot);
  if (laneId === null) return;
  let mainId: string | null;
  try {
    mainId = projectIdAt(root);
  } catch {
    mainId = null;
  }
  if (mainId !== null && laneId !== mainId) {
    throw new WorktreeBindingError(
      `this worktree's .construct/project.json (${laneRoot}) names project ${laneId}, but the main checkout's (${root}) names ${mainId}`,
      'One repository is one project. Bring the worktree’s .construct/project.json back in line with the main checkout’s.',
    );
  }
}

/** The lane a session in `sessionCwd` works in, when that is a linked worktree of the repository holding `root`. */
function laneFor(root: string, sessionCwd: string): Lane | null {
  const repo = resolveRepository(sessionCwd);
  if (!repo?.linked || repo.mainRoot === null) return null;
  // Git records worktree paths resolved; compare real paths so an aliased
  // spelling of the same directory (macOS /var and /private/var) still matches.
  const rel = relative(realpathOr(repo.mainRoot), realpathOr(root));
  if (rel.startsWith('..') || isAbsolute(rel)) return null;
  const lane: Lane = { root: join(repo.checkout, rel), checkout: repo.checkout, branch: repo.branch, head: repo.head };
  requireSameProject(root, lane.root);
  return lane;
}

function realpathOr(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

/**
 * Every git checkout of the repository holding the project at `root` (its
 * directory in the main checkout), read from files alone as a session's lane
 * is: the main checkout first, then each linked worktree recorded under the
 * common directory's `worktrees/` whose checkout still exists, in path order.
 * Each names the project's directory inside it, spelled as the file system
 * resolves it, and the branch it has checked out. A worktree whose project
 * file names a different project, or cannot be read, is left out, as a
 * session there is refused.
 * Empty when the project is in no repository or its repository has no main
 * checkout.
 */
export function projectWorktrees(root: string): ProjectWorktree[] {
  const repo = resolveRepository(root);
  if (repo === null || repo.mainRoot === null) return [];
  const mainReal = realpathOr(repo.mainRoot);
  const rel = relative(mainReal, realpathOr(root));
  if (rel.startsWith('..') || isAbsolute(rel)) return [];
  const main = repo.linked ? resolveRepository(repo.mainRoot) : repo;
  const out: ProjectWorktree[] = [{ root: join(mainReal, rel), checkout: mainReal, branch: main?.branch ?? null, head: main?.head ?? null, main: true }];
  const records = join(repo.commonDir, 'worktrees');
  let names: string[];
  try {
    names = readdirSync(records);
  } catch {
    names = [];
  }
  const common = realpathOr(repo.commonDir);
  const linked: ProjectWorktree[] = [];
  for (const name of names) {
    const recorded = readTrimmed(join(records, name, 'gitdir'));
    if (!recorded) continue;
    // Git writes an absolute path unless worktree.useRelativePaths is set; a relative one is relative to the record.
    const checkout = realpathOr(dirname(isAbsolute(recorded) ? recorded : resolve(records, name, recorded)));
    const found = existsSync(join(checkout, '.git')) ? resolveRepository(checkout) : null;
    if (found === null || !found.linked || realpathOr(found.checkout) !== checkout || realpathOr(found.commonDir) !== common) continue;
    const laneRoot = join(checkout, rel);
    try {
      requireSameProject(root, laneRoot);
    } catch {
      continue;
    }
    linked.push({ root: laneRoot, checkout, branch: found.branch, head: found.head, main: false });
  }
  linked.sort((a, b) => (a.checkout < b.checkout ? -1 : a.checkout > b.checkout ? 1 : 0));
  return [...out, ...linked];
}

/** `path` as the file system resolves it, through its nearest existing directory when the path itself does not exist. */
function realpathThrough(path: string): string {
  const missing: string[] = [];
  let dir = resolve(path);
  for (;;) {
    try {
      return join(realpathSync(dir), ...missing.reverse());
    } catch {
      const parent = dirname(dir);
      if (parent === dir) return resolve(path);
      missing.push(basename(dir));
      dir = parent;
    }
  }
}

/**
 * Which of the project's checkouts holds `path`, and the path relative to its
 * top: the deepest one containing it, since a worktree may sit inside the main
 * checkout. Null when no checkout of the project holds it.
 */
export function worktreeHolding(root: string, path: string): { readonly worktree: ProjectWorktree; readonly path: string } | null {
  const real = realpathThrough(path);
  let best: { worktree: ProjectWorktree; path: string } | null = null;
  for (const worktree of projectWorktrees(root)) {
    const rel = relative(worktree.checkout, real);
    if (rel.startsWith('..') || isAbsolute(rel)) continue;
    if (best === null || worktree.checkout.length > best.worktree.checkout.length) best = { worktree, path: rel };
  }
  return best;
}

/** The nearest directory at or above `start`, up to `floor`, holding a project store. */
function findStoreRoot(start: string, floor: string): string | null {
  let dir = resolve(start);
  const top = resolve(floor);
  for (;;) {
    if (existsSync(projectDbPath(dir))) return dir;
    if (dir === top) return null;
    const parent = dirname(dir);
    if (parent === dir || relative(top, parent).startsWith('..')) return null;
    dir = parent;
  }
}

/**
 * Find the project this directory belongs to, never crossing a repository,
 * without reading its configuration. In a linked git worktree the project is
 * the one in the main checkout, and the worktree becomes the session's lane.
 * When the main checkout's current commit carries no project files but the
 * project's store is where they would be, the lane binds to that store.
 */
export function locateProject(ctx: CliContext): ProjectLocation {
  const repo = resolveRepository(ctx.cwd);
  const mainRoot = repo === null ? null : mainCheckoutOf(repo);
  const floor = repo?.checkout ?? ctx.cwd;
  const here = findProjectRoot({ start: ctx.cwd, floor });
  if (repo === null || mainRoot === null || !repo.linked) {
    if (here === null) {
      const orphan = findStoreRoot(ctx.cwd, floor);
      if (orphan !== null) {
        throw new OperationError(
          `${orphan} has a Construct store but no .construct/project.json (the current commit may not carry the project files)`,
          `Restore the .construct files in ${orphan}, for example by checking out the commit that has them. Running \`construct init\` first would give this project a new id, so init refuses; \`construct reset\` discards the store instead.`,
        );
      }
      throw new NoProjectError(resolve(ctx.cwd));
    }
    return { root: here, lane: ctx.sessionCwd === undefined ? null : laneFor(here, ctx.sessionCwd) };
  }
  const sameRelative = (dir: string): string => join(mainRoot, relative(repo.checkout, dir));
  const root = here !== null
    ? sameRelative(here)
    : findProjectRoot({ start: sameRelative(ctx.cwd), floor: mainRoot }) ?? findStoreRoot(sameRelative(ctx.cwd), mainRoot);
  if (root === null || (!hasProject(root) && !existsSync(projectDbPath(root)))) {
    if (here !== null) {
      throw new WorktreeBindingError(
        `this is a git worktree of ${mainRoot}, and that checkout has neither the project files nor the store of the project this worktree's .construct/project.json describes (expected at ${root})`,
        `Restore the .construct files in ${mainRoot} (for example by checking out the branch that has them), then run \`construct init\` there if it still has no store. Running init before the files are back would give this project a new id.`,
      );
    }
    throw new WorktreeBindingError(
      `this is a git worktree of ${mainRoot}, and that checkout has no Construct project`,
      `Run \`construct init\` in ${mainRoot}; its one store serves every worktree of the repository.`,
    );
  }
  const lane: Lane = { root: join(repo.checkout, relative(mainRoot, root)), checkout: repo.checkout, branch: repo.branch, head: repo.head };
  requireSameProject(root, lane.root);
  return { root, lane };
}

/**
 * Bind to the project this directory belongs to and read its configuration
 * from the main checkout. The worktree never gets a store of its own.
 */
export function bindProject(ctx: CliContext): BoundProject {
  const located = locateProject(ctx);
  return { ...located, layout: projectLayout(located.root), files: readProjectFiles(located.root) };
}

/**
 * Committed project files are edited only from the main checkout. A lane's
 * copies may differ from the main checkout's, and editing another checkout's
 * working tree would surprise whoever works there. `what` names the command.
 */
export function requireMainCheckout(bound: ProjectLocation, what: string): void {
  if (bound.lane === null) return;
  throw new WorktreeBindingError(
    `${what} edits the project's committed .construct files, which are read from the main checkout (${bound.root}), and this runs in the git worktree ${bound.lane.checkout}`,
    `Run it in ${bound.root}. To change them on this worktree's branch instead, edit ${join(bound.lane.root, '.construct')} and merge it.`,
  );
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
      bound.lane ? `Run \`construct init\` in ${bound.root} to create it; every worktree shares that one store.` : 'Run `construct init` to create it.',
    );
  }
  try {
    const store = openStateStore(bound.layout.dbPath, { readOnly: ctx.readOnly === true, busyTimeoutMs: ctx.stateBusyTimeoutMs });
    try {
      if (bound.files.config) bindStoreToProject(store, bound.files.config.id);
      else if (bound.lane) {
        const laneId = laneProjectId(bound.lane.root);
        if (laneId !== null) bindStoreToProject(store, laneId, { stamp: false });
      }
    } catch (error) {
      store.close();
      throw error;
    }
    return { ...bound, store };
  } catch (error) {
    if (error instanceof UnsupportedStateError || error instanceof StoreProjectError) throw error;
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
