/**
 * lib/project-root.mjs — resolve "what Construct project am I in?" from any cwd.
 *
 * Writers that own per-project state (contract violations, audit reads, agent
 * dispatches, intent verifications) call `resolveProjectScope()` to decide
 * which `<project>/.construct/<file>.jsonl` to write to. When no project is
 * detected, the call returns `null` and writers fall back to the global
 * user-scope path (`<doctorRoot>/<file>.jsonl`) so existing standalone hook
 * invocations don't lose data.
 *
 * Writers that own cross-project telemetry (skill calls, role-pending,
 * session cost) keep using the global doctor root but tag each entry with the
 * `projectId` from `resolveProjectId()` so a reader can attribute the
 * entry to a specific project later.
 *
 * The project marker is `.construct/` at the project root. The
 * lookup walks upward from cwd; the first ancestor matching either marker
 * wins. Result is memoized per cwd so the hot path doesn't restat the
 * filesystem on every append.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

import { doctorRoot } from './config/xdg.mjs';
import { PROJECT_MARKERS, projectConfigDir, configPath } from './config-dir.mjs';

const HOME = os.homedir();
const MARKERS = PROJECT_MARKERS;
const cache = new Map();   // cwd → { projectRoot, projectId, scope } | null

/**
 * Walk upward from `start` until a directory containing `.construct/` or
 * `.construct/` is found. Returns the absolute project-root path or null.
 * Stops at the filesystem root and at $HOME (so `~/.construct/` doesn't make
 * the user's entire home directory look like a project).
 */
export function findProjectRoot(start = process.cwd()) {
  let dir = path.resolve(start);
  const stop = path.resolve(HOME);
  while (true) {
    if (MARKERS.some((m) => fs.existsSync(path.join(dir, m)))) return dir;
    if (dir === stop) return null;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Deterministic short identifier for a project. Stable across sessions on
 * the same machine, derived from the absolute project-root path. Useful for
 * tagging cross-project telemetry entries (`projectId: "a7c4f2"`) without
 * leaking the absolute filesystem path.
 */
export function projectIdFor(projectRoot) {
  if (!projectRoot) return null;
  return createHash('sha256').update(path.resolve(projectRoot)).digest('hex').slice(0, 12);
}

/**
 * Resolve the project scope for a writer call site. Returns:
 *   { projectRoot, projectId, constructDir }
 *     when the cwd (or a parent) is a Construct project. `constructDir` is the
 *     absolute path to `<projectRoot>/.construct/` (created on demand by callers).
 *   null
 *     when no project is detected; the caller should fall back to the
 *     legacy user-scope path.
 */
export function resolveProjectScope(cwd = process.cwd()) {
  if (cache.has(cwd)) return cache.get(cwd);
  const projectRoot = findProjectRoot(cwd);
  if (!projectRoot) {
    cache.set(cwd, null);
    return null;
  }
  const result = {
    projectRoot,
    projectId: projectIdFor(projectRoot),
    constructDir: projectConfigDir(projectRoot),
  };
  cache.set(cwd, result);
  return result;
}

/**
 * For project-scoped writers: returns the `<project>/.construct/<basename>` path
 * when cwd is inside a Construct project, otherwise the global
 * `<doctorRoot>/<basename>` path. Callers pass just the file basename; this
 * helper resolves the directory side. ensureDir=true creates the parent dir.
 */
export function resolveProjectScopedPath(basename, { cwd, ensureDir = true } = {}) {
  const scope = resolveProjectScope(cwd ?? process.cwd());
  const dir = scope ? scope.constructDir : doctorRoot();
  if (ensureDir && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, basename);
}

/**
 * Clear the memoization cache. Test-only — every other caller benefits
 * from the cache surviving across calls in the same process.
 */
export function _resetCache() {
  cache.clear();
}

// Canonical project root for daemon, approval queue, and CLI surfaces.

const PROJECT_WALKUP_MAX = 10;

/**
 * Walk up from `startDir` looking for `.construct/context.md`.
 * Returns the project root path, or null if nothing is found within the cap.
 */
export function findInitProjectRoot(startDir, { maxLevels = PROJECT_WALKUP_MAX } = {}) {
  if (!startDir || typeof startDir !== 'string') return null;
  let current = startDir;
  for (let i = 0; i <= maxLevels; i++) {
    try {
      if (fs.existsSync(configPath(current, 'context.md'))) return current;
    } catch { /* skip unreadable dir */ }
    const parent = path.dirname(current);
    if (!parent || parent === current) return null;
    current = parent;
  }
  return null;
}

function findGitRoot(startDir) {
  try {
    const out = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: startDir,
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
    }).toString().trim();
    return out || null;
  } catch {
    return null;
  }
}

/**
 * Resolve the canonical project root for cross-process durable state.
 *
 * Precedence:
 *   1. `CONSTRUCT_DATA_DIR` env override
 *   2. Project root from `.construct/context.md` walk-up
 *   3. Git working-tree top level containing `cwd`
 *   4. `os.homedir()` fallback
 */
export function resolveRootDir(env = process.env, cwd = process.cwd()) {
  const override = (env.CONSTRUCT_DATA_DIR ?? '').trim();
  if (override) return override;
  const projectRoot = findInitProjectRoot(cwd);
  if (projectRoot) return projectRoot;
  const gitRoot = findGitRoot(cwd);
  if (gitRoot) return gitRoot;
  return os.homedir();
}
