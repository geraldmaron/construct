/**
 * lib/project-root.mjs — resolve "what Construct project am I in?" from any cwd.
 *
 * Writers that own per-project state (contract violations, audit reads, agent
 * dispatches, intent verifications) call `resolveProjectScope()` to decide
 * which `<project>/.cx/<file>.jsonl` to write to. When no project is
 * detected, the call returns `null` and writers fall back to the global
 * user-scope path (`<doctorRoot>/<file>.jsonl`) so existing standalone hook
 * invocations don't lose data.
 *
 * Writers that own cross-project telemetry (skill calls, role-pending,
 * session cost) keep using the global doctor root but tag each entry with the
 * `projectId` from `resolveProjectId()` so a reader can attribute the
 * entry to a specific project later.
 *
 * The project marker is `.cx/` or `.construct/` at the project root. The
 * lookup walks upward from cwd; the first ancestor matching either marker
 * wins. Result is memoized per cwd so the hot path doesn't restat the
 * filesystem on every append.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';

import { doctorRoot } from './config/xdg.mjs';
import { PROJECT_MARKERS, projectConfigDir } from './config-dir.mjs';

const MARKERS = PROJECT_MARKERS;
const cache = new Map();   // cwd → { projectRoot, projectId, scope } | null

// Symlink-tolerant normalization: on macOS, os.tmpdir()/$HOME come back in
// symlink form (/var/folders/...) while process.cwd() in a spawned child is
// already realpath'd (/private/var/folders/...) — a plain string comparison
// between the two forms never matches, so the walker silently blows past its
// intended stop directory (observed live in construct-4uxq0.14.6).

function normalizeDir(p) {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return path.resolve(p);
  }
}

/**
 * Walk upward from `start` until a directory containing `.cx/` or
 * `.construct/` is found. Returns the absolute project-root path or null.
 * Stops at the filesystem root, at $HOME, and at the OS tmpdir — the stop
 * check runs BEFORE the marker check, so `~/.construct/` (the user state
 * dir every real install has) and a stray `$TMPDIR/.construct` (leaked by
 * an unhermetic test, construct-4uxq0.14.6) can never make the entire home
 * directory or the shared OS tmpdir look like a project.
 */
export function findProjectRoot(start = process.cwd()) {
  let dir = path.resolve(start);
  const stops = new Set([normalizeDir(os.homedir()), normalizeDir(os.tmpdir())]);
  while (true) {
    if (stops.has(normalizeDir(dir))) return null;
    if (MARKERS.some((m) => fs.existsSync(path.join(dir, m)))) return dir;
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
 *   { projectRoot, projectId, cxDir }
 *     when the cwd (or a parent) is a Construct project. `cxDir` is the
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
    cxDir: projectConfigDir(projectRoot),
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
  const dir = scope ? scope.cxDir : doctorRoot();
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
