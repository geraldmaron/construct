/**
 * lib/state-root.mjs — machine-scoped state root for per-project heavy state (ADR-0066).
 *
 * A project directory keeps only committed text: construct.config.json,
 * .cx/context.md, user-authored custom specialists/teams/templates, and
 * ADR-0027 marker blocks. Heavy runtime state — traces, observations, the
 * vector index, task graphs, the docling/whisper bootstrap venvs — lives at
 * `~/.construct/projects/<key>/`, keyed by a derivation stable across clones
 * of the same git remote so two checkouts of one repository share
 * accumulated state. A project with no remote (a fresh local-only repo)
 * falls back to a hash of its resolved absolute path.
 *
 * `.beads/` is a deliberate exception (ADR-0026): issue history travels with
 * the repository and is never resolved through this module.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

import { constructDir } from './paths.mjs';

function normalizeRemote(url) {
  let s = url.trim();

  // `git@host:owner/repo.git` (scp-like shorthand) has no `scheme://` prefix,
  // so it needs its own split before the generic scheme/credential strip.
  const scp = s.match(/^[^@/]+@([^:]+):(.+)$/);
  if (scp && !/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(s)) {
    s = `${scp[1]}/${scp[2]}`;
  } else {
    s = s.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, '');
    s = s.replace(/^[^@/]+@/, '');
  }

  return s.replace(/\.git$/, '').replace(/\/+$/, '').toLowerCase();
}

function readOriginRemote(projectRoot) {
  try {
    const out = execFileSync('git', ['remote', 'get-url', 'origin'], {
      cwd: projectRoot,
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
    }).toString().trim();
    return out || null;
  } catch {
    return null;
  }
}

// The path-hash fallback (no remote) must be symlink-invariant: a caller that
// reaches the same directory through a symlinked path (e.g. macOS's /var/folders
// tmp symlink, or a home-directory alias) must still resolve to the same key.
// realpath is best-effort — a not-yet-created path falls back to path.resolve.

function canonicalPath(projectRoot) {
  const resolved = path.resolve(projectRoot);
  try {
    return fs.realpathSync(resolved);
  } catch {
    return resolved;
  }
}

/**
 * Derive a stable key for a project: the normalized git origin remote when
 * one exists (so every clone of the same repository resolves to the same
 * key), otherwise a hash of the canonical (symlink-resolved) absolute project
 * path.
 */
export function deriveProjectKey(projectRoot) {
  const resolved = path.resolve(projectRoot);
  const remote = readOriginRemote(resolved);
  const material = remote ? `remote:${normalizeRemote(remote)}` : `path:${canonicalPath(projectRoot)}`;
  return createHash('sha256').update(material).digest('hex').slice(0, 24);
}

// A trailing plain-object argument is an options bag ({ ensureDir }), never a
// path segment — path segments are always strings.

function popOptions(segments) {
  const last = segments[segments.length - 1];
  if (last !== null && typeof last === 'object' && !Array.isArray(last)) {
    return [segments.slice(0, -1), last];
  }
  return [segments, {}];
}

/**
 * Resolve the machine-scoped state root for a project. Creates the directory
 * (mkdir -p) on this access by default rather than up front — pass
 * `{ ensureDir: false }` for a caller that only wants the path (e.g. a probe
 * that may never actually write). Built on constructDir() so the existing
 * CX_TOOLKIT_DIR override relocates per-project state along with the rest of
 * `~/.construct/`.
 */
export function resolveStateRoot(projectRoot, { ensureDir = true } = {}) {
  const dir = path.join(constructDir(), 'projects', deriveProjectKey(projectRoot));
  if (ensureDir) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Resolve a subdirectory under a project's state root, creating it by
 * default. Pass a trailing `{ ensureDir: false }` to skip creation.
 */
export function resolveStateDir(projectRoot, ...segments) {
  const [parts, { ensureDir = true }] = popOptions(segments);
  const dir = path.join(resolveStateRoot(projectRoot, { ensureDir: false }), ...parts);
  if (ensureDir) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Resolve a file path under a project's state root, creating the parent
 * directory (not the file itself) by default. Pass a trailing
 * `{ ensureDir: false }` to skip creation.
 */
export function resolveStatePath(projectRoot, ...segments) {
  const [parts, { ensureDir = true }] = popOptions(segments);
  const filePath = path.join(resolveStateRoot(projectRoot, { ensureDir: false }), ...parts);
  if (ensureDir) fs.mkdirSync(path.dirname(filePath), { recursive: true });
  return filePath;
}
