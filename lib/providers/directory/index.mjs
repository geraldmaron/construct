/**
 * lib/providers/directory/index.mjs — Local directory data-source provider.
 *
 * Provides read/search capabilities over a configured local directory with
 * include/exclude glob patterns and file size limits. Security: all paths
 * resolve and remain within the configured root; symlink escape and
 * traversal (../) are rejected.
 *
 * Capabilities: read, search.
 *
 * Config (per call):
 *   - root: absolute or relative path to the directory root (required)
 *   - include: array of glob patterns (optional, defaults to ["**\/*"])
 *   - exclude: array of glob patterns to filter out (optional)
 *   - maxFileKB: integer max file size in KB (default 1024, max 10240)
 *
 * Glob support is the in-tree subset (lib/rules-delivery.mjs):
 * `**\/` spans directories, `*` stays within a segment, and a pattern without
 * a slash matches basenames (`*.md` matches nested files).
 */

import { existsSync, statSync, readdirSync, readFileSync } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';
import { globToRegExp } from '../../rules-delivery.mjs';

/**
 * Verify that path is within root and not a symlink escape.
 * Returns { ok: true } or { ok: false, reason: '...' }.
 */
function validatePathSecurity(root, checkPath) {
  try {
    const realRoot = statSync(root).ino;
    const stats = statSync(checkPath);

    if (stats.isSymbolicLink()) {
      return { ok: false, reason: 'symlink not allowed' };
    }

    const realPath = statSync(checkPath).ino;
    if (realPath !== realRoot) {
      const rel = relative(root, checkPath);
      if (rel.startsWith('..')) {
        return { ok: false, reason: 'path escape detected' };
      }
    }

    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

/**
 * Resolve and validate a path within root. Returns { ok, path } or
 * { ok: false, reason }.
 */
function resolvePath(root, candidate) {
  const rootPath = isAbsolute(root) ? root : resolve(process.cwd(), root);

  if (!existsSync(rootPath)) {
    return { ok: false, reason: `root does not exist: ${rootPath}` };
  }

  const stat = statSync(rootPath);
  if (!stat.isDirectory()) {
    return { ok: false, reason: `root is not a directory: ${rootPath}` };
  }

  const resolved = isAbsolute(candidate)
    ? candidate
    : resolve(rootPath, candidate);

  const validation = validatePathSecurity(rootPath, resolved);
  if (!validation.ok) {
    return { ok: false, reason: validation.reason };
  }

  return { ok: true, path: resolved, root: rootPath };
}

// A pattern without a slash tests the basename so `*.md` matches nested files,
// mirroring the matchBase behavior read() and search() have always documented.

function compileMatchers(patterns) {
  const compiled = patterns.map((pat) => ({ re: globToRegExp(pat), baseOnly: !pat.includes('/') }));
  return (relativePath, name) => compiled.some(({ re, baseOnly }) => re.test(baseOnly ? name : relativePath));
}

/**
 * Walk directory recursively, matching include/exclude globs.
 */
function walkDir(dirPath, { include = ['**/*'], exclude = [] }) {
  const results = [];
  const stat = statSync(dirPath);
  if (!stat.isDirectory()) return results;

  const includes = compileMatchers(include);
  const excludes = compileMatchers(exclude);

  function walk(dir, prefix = '') {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = resolve(dir, entry.name);
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        walk(fullPath, relativePath);
      } else if (entry.isFile()) {
        if (includes(relativePath, entry.name) && !excludes(relativePath, entry.name)) {
          results.push({ path: fullPath, relativePath, name: entry.name });
        }
      }
    }
  }

  walk(dirPath);
  return results;
}

/**
 * Filter files by size constraint.
 */
function filterBySize(items, maxFileSizeKB) {
  const maxBytes = maxFileSizeKB * 1024;
  return items.filter((item) => {
    try {
      const stat = statSync(item.path);
      return stat.size <= maxBytes;
    } catch {
      return false;
    }
  });
}

/**
 * Read all matching files from the directory.
 */
async function readAllFiles(config) {
  const root = config?.root;
  if (!root) throw new Error('directory.read: config.root required');

  const { ok, path, root: rootPath } = resolvePath(root, '.');
  if (!ok) throw new Error(`directory.read: ${path}`);

  const include = Array.isArray(config.include) ? config.include : ['**/*'];
  const exclude = Array.isArray(config.exclude) ? config.exclude : [];
  const maxKB = Math.min(config?.maxFileKB || 1024, 10240);

  const items = walkDir(rootPath, { include, exclude });
  const filtered = filterBySize(items, maxKB);

  return filtered.map((item) => ({
    path: item.relativePath,
    name: item.name,
    mtime: statSync(item.path).mtimeMs,
    size: statSync(item.path).size,
  }));
}

/**
 * Search for a substring within matching files.
 */
async function searchFiles(config, query) {
  if (!query || typeof query !== 'string') {
    throw new Error('directory.search: query required (substring or glob pattern)');
  }

  const root = config?.root;
  if (!root) throw new Error('directory.search: config.root required');

  const { ok, path, root: rootPath } = resolvePath(root, '.');
  if (!ok) throw new Error(`directory.search: ${path}`);

  const include = Array.isArray(config.include) ? config.include : ['**/*'];
  const exclude = Array.isArray(config.exclude) ? config.exclude : [];
  const maxKB = Math.min(config?.maxFileKB || 1024, 10240);

  const items = walkDir(rootPath, { include, exclude });
  const filtered = filterBySize(items, maxKB);

  const results = [];

  for (const item of filtered) {
    try {
      const content = readFileSync(item.path, 'utf8');
      if (content.includes(query)) {
        results.push({
          path: item.relativePath,
          name: item.name,
          mtime: statSync(item.path).mtimeMs,
          size: statSync(item.path).size,
          preview: content.slice(0, 200),
        });
      }
    } catch {
      // Skip files we cannot read
    }
  }

  return results;
}

export function create({ env = process.env } = {}) {
  return {
    meta: {
      id: 'directory',
      displayName: 'Local Directory',
      capabilities: ['read', 'search'],
      description: 'Read and search files in a local directory.',
    },

    configSchema: {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: {
        root: {
          type: 'string',
          description: 'Path to the root directory (absolute or relative to cwd)',
        },
        include: {
          type: 'array',
          items: { type: 'string' },
          description: 'Glob patterns to include (default: ["**/*"])',
          default: ['**/*'],
        },
        exclude: {
          type: 'array',
          items: { type: 'string' },
          description: 'Glob patterns to exclude (default: [])',
          default: [],
        },
        maxFileKB: {
          type: 'integer',
          minimum: 1,
          maximum: 10240,
          default: 1024,
          description: 'Maximum file size in KB (default 1024)',
        },
      },
      required: ['root'],
    },

    async health(config) {
      const root = config?.root;
      if (!root) {
        return { ok: false, detail: 'config.root not set' };
      }

      const { ok, reason, root: rootPath } = resolvePath(root, '.');
      if (!ok) {
        return { ok: false, detail: reason };
      }

      try {
        const entries = readdirSync(rootPath);
        return { ok: true, detail: `directory readable (${entries.length} entries)` };
      } catch (err) {
        return { ok: false, detail: err.message };
      }
    },

    read: readAllFiles,
    search: searchFiles,
  };
}

export default create;
