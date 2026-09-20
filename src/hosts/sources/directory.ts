/**
 * hosts/sources/directory.ts — reading a directory source.
 *
 * Walks the tree the locator names, skipping version-control and dependency
 * directories and Construct's own state. Inventory activity (path/size/mtime)
 * is digested separately from file contents. Material claims use the content
 * digest. The walk is contained inside the locator when that locator is a
 * project path; a locator that itself escapes is unreachable.
 */

import { createHash } from 'node:crypto';
import { readdirSync, openSync, readSync, closeSync, constants } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import type { ReadOutcome, SourceReader, SnapshotItem } from '../../kernel/source/connector.ts';
import { inspectContained, isInside } from '../../kernel/safety/containment.ts';

export const DIRECTORY_ENTRY_CAP = 5000;
export const DIRECTORY_CONTENT_CAP = 65_536;
const SKIP = new Set(['.git', 'node_modules', '.construct', 'dist', '.cache', '.venv', '__pycache__']);

interface Entry {
  readonly rel: string;
  readonly size: number;
  readonly mtime: number;
  readonly contentDigest: string;
}

function hashBytes(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function readCapped(path: string, cap: number): { digest: string; truncated: boolean } {
  let fd: number;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch {
    return { digest: 'unreadable', truncated: false };
  }
  try {
    const buf = Buffer.alloc(cap);
    const n = readSync(fd, buf, 0, cap, 0);
    const slice = n === cap ? buf : buf.subarray(0, n);
    return { digest: hashBytes(slice), truncated: n === cap };
  } catch {
    return { digest: 'unreadable', truncated: false };
  } finally {
    closeSync(fd);
  }
}

function walk(root: string, dir: string, out: Entry[], skippedOutside: string[]): void {
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
    if (!isInside(root, path)) {
      skippedOutside.push(relative(root, path).split(sep).join('/'));
      continue;
    }
    const inspect = inspectContained(root, path);
    if (!inspect.ok) {
      skippedOutside.push(relative(root, path).split(sep).join('/'));
      continue;
    }
    if (inspect.stat.isDirectory()) {
      walk(root, inspect.realPath, out, skippedOutside);
    } else if (inspect.stat.isFile()) {
      const content = readCapped(inspect.realPath, DIRECTORY_CONTENT_CAP);
      out.push({
        rel: relative(root, inspect.realPath).split(sep).join('/'),
        size: inspect.stat.size,
        mtime: Math.floor(inspect.stat.mtimeMs),
        contentDigest: content.digest,
      });
    }
  }
}

export const readDirectorySource: SourceReader = async ({ locator }): Promise<ReadOutcome> => {
  if (locator === null) return { outcome: 'unreachable', reason: 'the source names no directory' };
  const root = resolve(locator);
  const inspect = inspectContained(root, root);
  if (!inspect.ok || !inspect.stat.isDirectory()) {
    try {
      const { statSync } = await import('node:fs');
      const st = statSync(root);
      if (!st.isDirectory()) return { outcome: 'unreachable', reason: `${locator} is not a directory` };
    } catch (error) {
      return { outcome: 'unreachable', reason: `${locator}: ${(error as NodeJS.ErrnoException).code ?? 'cannot read'}` };
    }
  }
  const entries: Entry[] = [];
  const skippedOutside: string[] = [];
  walk(root, root, entries, skippedOutside);
  entries.sort((a, b) => a.rel.localeCompare(b.rel));
  const inventory = entries.map((e) => `${e.rel}\t${String(e.size)}\t${String(e.mtime)}`).join('\n');
  const content = entries.map((e) => `${e.rel}\t${e.contentDigest}`).join('\n');
  const inventoryDigest = `sha256:${createHash('sha256').update(inventory).digest('hex')}`;
  const contentDigest = `sha256:${createHash('sha256').update(content).digest('hex')}`;
  const capped = entries.length >= DIRECTORY_ENTRY_CAP ? ` (capped at ${String(DIRECTORY_ENTRY_CAP)})` : '';
  const items: SnapshotItem[] = entries.slice(0, 200).map((e) => ({
    externalRef: e.rel,
    kind: 'document',
    name: e.rel,
    attributes: { size: e.size, mtime: e.mtime, contentDigest: e.contentDigest },
  }));
  return {
    outcome: 'read',
    report: {
      digest: contentDigest,
      summary: `${String(entries.length)} file(s) under ${locator}${capped}`,
      evidenceRef: locator,
      evidence: 'witnessed',
      items,
      inventoryDigest,
      contentDigest,
      coverage: {
        capped: entries.length >= DIRECTORY_ENTRY_CAP,
        skippedOutside,
        itemCount: entries.length,
      },
    },
  };
};
