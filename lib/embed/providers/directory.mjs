/**
 * lib/embed/providers/directory.mjs — local directory provider for embed mode.
 *
 * Reads markdown/doc files from a registered local directory target so a
 * checked-out repository or docs folder can act as a context source. Purely
 * local: it walks the filesystem and never opens a socket, satisfying the
 * directory-targets-never-touch-the-network invariant. Requires no
 * credentials, so ProviderRegistry always registers it.
 *
 * Supported refs:
 *   docs     Doc/markdown files under the path (bounded depth, doc extensions)
 *   readme   The top-level README, when present
 *   meta     A one-line summary of the directory (path + doc file count)
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, extname, join, relative } from 'node:path';

import { expandTilde } from '../../config/source-targets.mjs';

const DOC_EXTS = new Set(['.md', '.mdx', '.markdown', '.txt', '.rst', '.adoc']);

// Directories that are noise for a docs corpus: version-control internals,
// dependency trees, and build output dwarf the actual documentation.
const SKIP_DIRS = new Set(['.git', 'node_modules', '.construct', 'dist', 'build', 'coverage', '.next', 'vendor']);

const DOC_CONTENT_LIMIT = 8_000;
const MAX_DEPTH = 10;

function isReadme(name) {
  return /^readme(\.\w+)?$/i.test(name);
}

function collectDocFiles(rootDir) {
  const files = [];
  const stack = [{ dir: rootDir, depth: 0 }];
  while (stack.length > 0) {
    const { dir, depth } = stack.pop();
    if (depth >= MAX_DEPTH) continue;
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (entry.name.startsWith('.') && entry.isDirectory()) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        stack.push({ dir: full, depth: depth + 1 });
        continue;
      }
      if (entry.isFile() && DOC_EXTS.has(extname(entry.name).toLowerCase())) files.push(full);
    }
  }
  return files.sort((a, b) => a.localeCompare(b));
}

function readDoc(rootDir, filePath) {
  const rel = relative(rootDir, filePath);
  let content = '';
  try { content = readFileSync(filePath, 'utf8').slice(0, DOC_CONTENT_LIMIT); } catch { return null; }
  return {
    type: 'doc',
    source: 'directory',
    path: rel,
    content,
    summary: `Doc ${rel}`,
  };
}

export class DirectoryProvider {
  /**
   * @param {string} ref   - 'docs' | 'readme' | 'meta'
   * @param {object} opts  - { path, limit }
   * @returns {Promise<Item[]>}
   */
  async read(ref, opts = {}) {
    const rawPath = opts.path ?? opts.dir;
    if (!rawPath) throw new Error('Directory source requires a "path" field');
    const rootDir = expandTilde(String(rawPath));

    let stat;
    try { stat = statSync(rootDir); } catch {
      return [{ type: 'error', source: 'directory', path: rootDir, ref, message: `path not found: ${rootDir}` }];
    }
    if (!stat.isDirectory()) {
      return [{ type: 'error', source: 'directory', path: rootDir, ref, message: `not a directory: ${rootDir}` }];
    }

    const limit = Number(opts.limit ?? 100);

    if (ref === 'meta') {
      const count = collectDocFiles(rootDir).length;
      return [{
        type: 'meta',
        source: 'directory',
        path: rootDir,
        description: `Local directory ${basename(rootDir)} (${count} doc file(s))`,
        summary: `Directory ${rootDir}: ${count} doc file(s)`,
      }];
    }

    const files = collectDocFiles(rootDir);

    if (ref === 'readme') {
      const readme = files.find((f) => isReadme(basename(f)));
      if (!readme) return [];
      const rec = readDoc(rootDir, readme);
      return rec ? [rec] : [];
    }

    const records = [];
    for (const file of files.slice(0, limit)) {
      const rec = readDoc(rootDir, file);
      if (rec) records.push(rec);
    }
    return records;
  }
}
