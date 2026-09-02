/**
 * hosts/sources/directory.ts — reading a directory source: what files are
 * there, digested so a refresh can tell whether anything changed.
 *
 * Walks the tree the locator names, skipping version-control and dependency
 * directories and Construct's own state, and digests the sorted list of
 * relative path, size, and modification time. It never reads file contents;
 * a workflow step that needs them reads the specific files it cites.
 */

import { createHash } from 'node:crypto';
import { readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { ReadOutcome, SourceReader } from '../../kernel/source/connector.ts';

export const DIRECTORY_ENTRY_CAP = 5000;
const SKIP = new Set(['.git', 'node_modules', '.construct', 'dist', '.cache', '.venv', '__pycache__']);

function walk(root: string, dir: string, out: string[]): void {
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
        const st = statSync(path);
        out.push(`${relative(root, path).split(sep).join('/')}\t${String(st.size)}\t${String(Math.floor(st.mtimeMs))}`);
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
  const lines: string[] = [];
  walk(locator, locator, lines);
  lines.sort();
  const digest = `sha256:${createHash('sha256').update(lines.join('\n')).digest('hex')}`;
  const capped = lines.length >= DIRECTORY_ENTRY_CAP ? ` (capped at ${String(DIRECTORY_ENTRY_CAP)})` : '';
  return {
    outcome: 'read',
    report: {
      digest,
      summary: `${String(lines.length)} file(s) under ${locator}${capped}`,
      evidenceRef: locator,
      evidence: 'witnessed',
    },
  };
};
