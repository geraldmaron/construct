/**
 * hosts/sources/directory.ts — reading a directory source: what files are
 * there, digested so a refresh can tell whether anything changed.
 *
 * Walks the tree the locator names, skipping version-control and dependency
 * directories and Construct's own state, and digests the sorted list of
 * relative path and content hash, so touching a file without changing it is
 * not a change. Inventory activity (path, size, mtime) is digested separately
 * from that content digest. The walk is contained inside the locator: a link
 * whose real path stays inside is followed, one that leaves is skipped and
 * reported, a locator that itself escapes is unreachable, and another
 * checkout nested inside (a linked worktree, a submodule) is not walked. Each file is reported as an item, which lets a refresh say
 * which files were added, removed, or modified. Files above the hashing cap
 * are identified by size and modification time instead.
 *
 * Hashes are reused by size and mtime, from this process's cache or from the
 * last recorded read, so a repeat read (bootstrap checks every directory
 * source at the start of each session) re-reads only what moved.
 *
 * A document can say it replaces another: a header line "Supersedes:
 * other.md" in the newer one, or "Status: Superseded" / "Superseded by: X"
 * in the older one. That is recorded on the item, because authority is
 * declared per source but documents inside a source go out of date one at
 * a time.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import type { PreviousItem, ReadOutcome, SnapshotItem, SourceReader } from '../../kernel/source/connector.ts';
import { inspectContained, isInside } from '../../kernel/safety/containment.ts';

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

function fingerprintOf(path: string, previous?: PreviousItem): Fingerprint {
  const st = statSync(path);
  const hit = cache.get(path);
  if (hit && hit.size === st.size && hit.mtimeMs === st.mtimeMs) return hit;
  const a = previous?.attributes;
  if (a && a.size === st.size && a.mtimeMs === st.mtimeMs && previous!.fingerprint) {
    const reused: Fingerprint = { size: st.size, mtimeMs: st.mtimeMs, fingerprint: previous!.fingerprint, supersedes: Array.isArray(a.supersedes) ? (a.supersedes as string[]) : [], supersededBy: typeof a.declaredSupersededBy === 'string' ? a.declaredSupersededBy : null };
    cache.set(path, reused);
    return reused;
  }
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

interface Walked {
  readonly rel: string;
  readonly fp: Fingerprint;
}

function walk(root: string, dir: string, out: Walked[], previous: ReadonlyMap<string, PreviousItem>, skippedOutside: string[]): void {
  if (out.length >= DIRECTORY_ENTRY_CAP) return;
  let entries: import('node:fs').Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (out.length >= DIRECTORY_ENTRY_CAP) return;
    if (SKIP.has(entry.name)) continue;
    const path = join(dir, entry.name);
    const inspect = isInside(root, path) ? inspectContained(root, path) : null;
    if (!inspect?.ok) {
      skippedOutside.push(relative(root, path).split(sep).join('/'));
      continue;
    }
    if (inspect.stat.isDirectory()) {
      // Another checkout nested here (a linked worktree, a submodule, a vendored
      // repository) is its own tree, not this source's content.
      if (existsSync(join(inspect.realPath, '.git'))) continue;
      walk(root, inspect.realPath, out, previous, skippedOutside);
    } else if (inspect.stat.isFile()) {
      try {
        const rel = relative(root, inspect.realPath).split(sep).join('/');
        out.push({ rel, fp: fingerprintOf(inspect.realPath, previous.get(rel)) });
      } catch {
        // a file that vanished mid-walk is not part of this read
      }
    }
  }
}

export const readDirectorySource: SourceReader = async ({ locator, previous }): Promise<ReadOutcome> => {
  if (locator === null) return { outcome: 'unreachable', reason: 'the source names no directory' };
  let root: string;
  let st;
  try {
    // Containment compares real paths, so the walk starts from the root's own (macOS spells /var as /private/var).
    root = realpathSync(resolve(locator));
    st = statSync(root);
  } catch (error) {
    return { outcome: 'unreachable', reason: `${locator}: ${(error as NodeJS.ErrnoException).code ?? 'cannot read'}` };
  }
  if (!st.isDirectory()) return { outcome: 'unreachable', reason: `${locator} is not a directory` };
  const files: Walked[] = [];
  const skippedOutside: string[] = [];
  walk(root, root, files, new Map((previous ?? []).map((p) => [p.ref, p])), skippedOutside);
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
  const inventoryDigest = `sha256:${createHash('sha256').update(files.map((f) => `${f.rel}\t${String(f.fp.size)}\t${String(Math.floor(f.fp.mtimeMs))}`).join('\n')).digest('hex')}`;
  const capped = files.length >= DIRECTORY_ENTRY_CAP ? ` (capped at ${String(DIRECTORY_ENTRY_CAP)})` : '';
  const items: SnapshotItem[] = files.map((f) => ({
    externalRef: f.rel,
    kind: 'file',
    name: f.rel.slice(f.rel.lastIndexOf('/') + 1),
    attributes: { fingerprint: f.fp.fingerprint, size: f.fp.size, mtimeMs: f.fp.mtimeMs, ...(f.fp.supersedes.length ? { supersedes: f.fp.supersedes } : {}), ...(f.fp.supersededBy ? { declaredSupersededBy: f.fp.supersededBy } : {}), ...(supersededBy.has(f.rel) ? { supersededBy: supersededBy.get(f.rel) } : {}) },
  }));
  return {
    outcome: 'read',
    report: {
      digest,
      summary: `${String(files.length)} file(s) under ${locator}${capped}`,
      evidenceRef: locator,
      evidence: 'witnessed',
      items,
      inventoryDigest,
      contentDigest: digest,
      coverage: { capped: files.length >= DIRECTORY_ENTRY_CAP, skippedOutside, itemCount: files.length },
    },
  };
};
