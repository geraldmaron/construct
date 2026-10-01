/**
 * hosts/sources/directory.ts — reading a directory source: what files are
 * there, digested so a refresh can tell whether anything changed.
 *
 * Walks the tree the locator names, skipping version-control and dependency
 * directories and Construct's own state, and digests the sorted list of
 * relative path and content hash, so touching a file without changing it is
 * not a change. Each file is reported as an item, which lets a refresh say
 * which files were added, removed, or modified. Files above the hashing cap
 * are identified by size and modification time instead.
 *
 * Hashes are cached per path by size and mtime, so a repeat read (bootstrap
 * checks every directory source) re-reads only what moved.
 *
 * A document can say it replaces another: a header line "Supersedes:
 * other.md" in the newer one, or "Status: Superseded" / "Superseded by: X"
 * in the older one. That is recorded on the item, because authority is
 * declared per source but documents inside a source go out of date one at
 * a time.
 */

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { ReadOutcome, SnapshotItem, SourceReader } from '../../kernel/source/connector.ts';

export const DIRECTORY_ENTRY_CAP = 5000;
/** Files larger than this are fingerprinted by size and mtime, not content. */
export const DIRECTORY_HASH_CAP_BYTES = 2 * 1024 * 1024;
/** How far into a document a supersession header is looked for. */
const HEADER_LINES = 40;
const SKIP = new Set(['.git', 'node_modules', '.construct', 'dist', '.cache', '.venv', '__pycache__']);
const TEXTUAL = /\.(?:md|markdown|txt|rst|adoc)$/i;

interface Fingerprint {
  readonly size: number;
  readonly mtimeMs: number;
  readonly fingerprint: string;
  readonly supersedes: readonly string[];
  readonly supersededBy: string | null;
}

const cache = new Map<string, Fingerprint>();

function headerFacts(text: string): { supersedes: string[]; supersededBy: string | null } {
  const supersedes: string[] = [];
  let supersededBy: string | null = null;
  for (const line of text.split('\n').slice(0, HEADER_LINES)) {
    const clean = line.replace(/^[\s>*_#-]+/, '').replace(/\*\*/g, '');
    const sup = /^supersedes\s*:\s*(.+)$/i.exec(clean);
    if (sup) supersedes.push(...sup[1]!.split(/[,;]/).map((x) => x.trim().replace(/^\[\[|\]\]$|^`|`$/g, '')).filter(Boolean));
    const by = /^superseded by\s*:\s*(.+)$/i.exec(clean);
    if (by) supersededBy = by[1]!.trim();
    else if (/(?:^|·\s*)status\s*:\s*superseded\b/i.test(clean) && supersededBy === null) supersededBy = '(the document says it is superseded)';
  }
  return { supersedes, supersededBy };
}

function fingerprintOf(path: string): Fingerprint {
  const st = statSync(path);
  const hit = cache.get(path);
  if (hit && hit.size === st.size && hit.mtimeMs === st.mtimeMs) return hit;
  let fp: Fingerprint;
  if (st.size <= DIRECTORY_HASH_CAP_BYTES) {
    const bytes = readFileSync(path);
    const facts = TEXTUAL.test(path) ? headerFacts(bytes.toString('utf8')) : { supersedes: [], supersededBy: null };
    fp = { size: st.size, mtimeMs: st.mtimeMs, fingerprint: createHash('sha256').update(bytes).digest('hex'), ...facts };
  } else {
    fp = { size: st.size, mtimeMs: st.mtimeMs, fingerprint: `size:${String(st.size)}:mtime:${String(Math.floor(st.mtimeMs))}`, supersedes: [], supersededBy: null };
  }
  cache.set(path, fp);
  return fp;
}

function walk(root: string, dir: string, out: { rel: string; fp: Fingerprint }[]): void {
  if (out.length >= DIRECTORY_ENTRY_CAP) return;
  let entries: import('node:fs').Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (out.length >= DIRECTORY_ENTRY_CAP) return;
    if (entry.isSymbolicLink() || SKIP.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(root, path, out);
    } else if (entry.isFile()) {
      try {
        out.push({ rel: relative(root, path).split(sep).join('/'), fp: fingerprintOf(path) });
      } catch {
        // a file that vanished mid-walk is not part of this read
      }
    }
  }
}

export const readDirectorySource: SourceReader = async ({ locator }): Promise<ReadOutcome> => {
  if (locator === null) return { outcome: 'unreachable', reason: 'the source names no directory' };
  let st;
  try {
    st = statSync(locator);
  } catch (error) {
    return { outcome: 'unreachable', reason: `${locator}: ${(error as NodeJS.ErrnoException).code ?? 'cannot read'}` };
  }
  if (!st.isDirectory()) return { outcome: 'unreachable', reason: `${locator} is not a directory` };
  const files: { rel: string; fp: Fingerprint }[] = [];
  walk(locator, locator, files);
  files.sort((a, b) => a.rel.localeCompare(b.rel));
  // Resolve "Supersedes: x" in a newer document onto the older item it names (by path or by file name).
  const supersededBy = new Map<string, string>();
  for (const f of files) {
    if (f.fp.supersededBy) supersededBy.set(f.rel, f.fp.supersededBy);
    for (const target of f.fp.supersedes) {
      const match = files.find((g) => g.rel === target || g.rel.endsWith(`/${target}`) || g.rel.slice(g.rel.lastIndexOf('/') + 1) === target);
      if (match && match.rel !== f.rel) supersededBy.set(match.rel, f.rel);
    }
  }
  const digest = `sha256:${createHash('sha256').update(files.map((f) => `${f.rel}\t${f.fp.fingerprint}`).join('\n')).digest('hex')}`;
  const capped = files.length >= DIRECTORY_ENTRY_CAP ? ` (capped at ${String(DIRECTORY_ENTRY_CAP)})` : '';
  const items: SnapshotItem[] = files.map((f) => ({
    externalRef: f.rel,
    kind: 'file',
    name: f.rel.slice(f.rel.lastIndexOf('/') + 1),
    attributes: { fingerprint: f.fp.fingerprint, ...(supersededBy.has(f.rel) ? { supersededBy: supersededBy.get(f.rel) } : {}) },
  }));
  return {
    outcome: 'read',
    report: { digest, summary: `${String(files.length)} file(s) under ${locator}${capped}`, evidenceRef: locator, evidence: 'witnessed', items },
  };
};
