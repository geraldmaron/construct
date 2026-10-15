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
 * which files were added, removed, or modified. Every read hashes the bytes,
 * including large files, in bounded memory. Metadata is inventory evidence,
 * never proof that the contents stayed the same.
 *
 * A document can say it replaces another: a header line "Supersedes:
 * other.md" in the newer one, or "Status: Superseded" / "Superseded by: X"
 * in the older one. That is recorded on the item, because authority is
 * declared per source but documents inside a source go out of date one at
 * a time.
 */

import { createHash } from 'node:crypto';
import { closeSync, constants, existsSync, fstatSync, openSync, readSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import type { ReadOutcome, SnapshotItem, SourceReader } from '../../kernel/source/connector.ts';
import { inspectContained, isInside } from '../../kernel/safety/containment.ts';
import { captureSourcePrefix, SOURCE_TEXT_CAP_BYTES } from '../../kernel/source/text.ts';

export const DIRECTORY_ENTRY_CAP = 5000;
/** Maximum buffer retained while hashing a file, regardless of its size. */
export const DIRECTORY_HASH_BUFFER_BYTES = 64 * 1024;
/** How far into a document a supersession header is looked for. */
const HEADER_LINES = 40;
const SKIP = new Set(['.git', '.codex', '.claude', '.cursor', '.bob', '.opencode', '.ssh', '.aws', 'node_modules', '.construct', 'dist', '.cache', '.venv', '__pycache__']);
const TEXTUAL = /\.(?:md|markdown|txt|rst|adoc|csv|ts|tsx|js|jsx|mjs|cjs|py|rs|go|java|html|css|sql|yaml|yml|json|toml)$/i;
const PRIVATE_TEXT = /(?:^|[\\/])(?:auth\.json|credentials(?:\.[^/]*)?|secrets?(?:\.[^/]*)?|\.env(?:\.[^/]*)?)$/i;

interface Fingerprint {
  readonly text?: string;
  readonly truncated?: boolean;
  readonly size: number;
  readonly mtimeMs: number;
  readonly fingerprint: string;
  readonly supersedes: readonly string[];
  readonly supersededBy: string | null;
}

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
  // The walk resolves links first. Refuse a replacement link at open time and
  // inspect the descriptor, not a path that might have been replaced meanwhile.
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = fstatSync(fd);
    if (!before.isFile()) throw new Error('source entry is no longer a regular file');
    const hash = createHash('sha256');
    const buffer = Buffer.allocUnsafe(DIRECTORY_HASH_BUFFER_BYTES);
    // The capture budget is independent of the streaming hash buffer. A few
    // lookahead bytes let the shared capture routine end on a UTF-8 boundary.
    const prefix = TEXTUAL.test(path) && !PRIVATE_TEXT.test(path) ? Buffer.allocUnsafe(SOURCE_TEXT_CAP_BYTES + 4) : null;
    let retained = 0;
    let total = 0;
    while (total < before.size) {
      const n = readSync(fd, buffer, 0, Math.min(buffer.length, before.size - total), null);
      if (n === 0) break;
      hash.update(buffer.subarray(0, n));
      if (prefix && retained < prefix.length) {
        const count = Math.min(n, prefix.length - retained);
        buffer.copy(prefix, retained, 0, count);
        retained += count;
      }
      total += n;
    }
    const after = fstatSync(fd);
    if (total !== before.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) {
      throw new Error('source entry changed during its read; retry the refresh');
    }
    const header = prefix?.subarray(0, retained).toString('utf8') ?? '';
    const capture = prefix && !header.includes('\0') ? captureSourcePrefix(prefix.subarray(0, retained), after.size > retained) : undefined;
    return { ...(capture ? { text: capture.text, truncated: capture.truncated } : {}), size: after.size, mtimeMs: after.mtimeMs, fingerprint: hash.digest('hex'), ...headerFacts(header) };
  } finally {
    closeSync(fd);
  }
}

interface Walked {
  readonly rel: string;
  readonly fp: Fingerprint;
}

function walk(root: string, dir: string, out: Walked[], visited: Set<string>, skippedOutside: string[]): void {
  if (out.length >= DIRECTORY_ENTRY_CAP || visited.has(dir)) return;
  visited.add(dir);
  const entries = readdirSync(dir, { withFileTypes: true });
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
      walk(root, inspect.realPath, out, visited, skippedOutside);
    } else if (inspect.stat.isFile()) {
      const rel = relative(root, inspect.realPath).split(sep).join('/');
      if (!out.some((item) => item.rel === rel)) out.push({ rel, fp: fingerprintOf(inspect.realPath) });
    }
  }
}

export const readDirectorySource: SourceReader = async ({ locator }): Promise<ReadOutcome> => {
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
  try {
    walk(root, root, files, new Set(), skippedOutside);
  } catch (error) {
    return { outcome: 'unreachable', reason: `incomplete directory read: ${(error as Error).message}` };
  }
  // A bounded inventory cannot certify absence. Keep the prior snapshot
  // intact rather than reporting unseen files as deleted.
  if (files.length >= DIRECTORY_ENTRY_CAP) return { outcome: 'unreachable', reason: `directory read reached its ${String(DIRECTORY_ENTRY_CAP)}-file limit; narrow the declared source` };
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
  const contentDigest = `sha256:${createHash('sha256').update(files.map((f) => `${f.rel}\t${f.fp.fingerprint}`).join('\n')).digest('hex')}`;
  const digest = `sha256:${createHash('sha256').update(`directory-text-v2:${contentDigest}`).digest('hex')}`;
  const inventoryDigest = `sha256:${createHash('sha256').update(files.map((f) => `${f.rel}\t${String(f.fp.size)}\t${String(Math.floor(f.fp.mtimeMs))}`).join('\n')).digest('hex')}`;
  const capped = files.length >= DIRECTORY_ENTRY_CAP ? ` (capped at ${String(DIRECTORY_ENTRY_CAP)})` : '';
  const items: SnapshotItem[] = files.map((f) => ({
    externalRef: f.rel,
    kind: 'file',
    name: f.rel.slice(f.rel.lastIndexOf('/') + 1),
    attributes: { ...(f.fp.text !== undefined ? {text:f.fp.text,truncated:f.fp.truncated} : {}), fingerprint: f.fp.fingerprint, size: f.fp.size, mtimeMs: f.fp.mtimeMs, ...(f.fp.supersedes.length ? { supersedes: f.fp.supersedes } : {}), ...(f.fp.supersededBy ? { declaredSupersededBy: f.fp.supersededBy } : {}), ...(supersededBy.has(f.rel) ? { supersededBy: supersededBy.get(f.rel) } : {}) },
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
      contentDigest,
      coverage: { capped: files.length >= DIRECTORY_ENTRY_CAP, skippedOutside, itemCount: files.length, unsupportedText: files.filter(f=>f.fp.text===undefined).map(f=>f.rel), truncatedText: files.filter(f=>f.fp.truncated).map(f=>f.rel) },
    },
  };
};
