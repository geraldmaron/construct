/**
 * hosts/mcp/visible-ground.ts — local documents first-run may seat from.
 *
 * Lives on the MCP surface so the projection can walk declared directory
 * and git sources (and `<cwd>/docs`) without reaching an execution
 * adapter. Remote kinds and remote git locators are skipped. The seating
 * decision itself lives in implication/ground.ts.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, isAbsolute, join } from 'node:path';
import type { GroundDocument } from '../../kernel/implication/ground.ts';
import type { Source } from '../../kernel/store/sources.ts';

const TITLE_BYTES = 2048;
const DOCUMENT_CAP = 40;
const HEADING = /^#{1,3}\s+(.+)$/m;
const PROSE_EXTS: ReadonlySet<string> = new Set(['.md', '.txt', '.rst', '.adoc']);
const SKIPPED_DIRS: ReadonlySet<string> = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'out',
  'coverage',
  'vendor',
  'target',
]);

function isRemoteGitLocator(locator: string): boolean {
  return /^(https?|git|ssh):\/\//.test(locator) || /^[\w.-]+@[\w.-]+:/.test(locator);
}

function resolveLocator(locator: string, cwd: string): string {
  return isAbsolute(locator) ? locator : join(cwd, locator);
}

function firstHeading(filePath: string): string | undefined {
  try {
    const size = statSync(filePath).size;
    if (size <= 0) return undefined;
    const text = readFileSync(filePath, { encoding: 'utf8' }).slice(0, TITLE_BYTES);
    const match = HEADING.exec(text);
    const title = match?.[1]?.trim();
    return title && title.length > 0 ? title : undefined;
  } catch {
    return undefined;
  }
}

function walk(dir: string, found: string[]): void {
  if (found.length >= DOCUMENT_CAP) return;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return;
  }
  for (const entry of entries) {
    if (found.length >= DOCUMENT_CAP) return;
    if (entry.name.startsWith('.')) continue;
    if (entry.isSymbolicLink()) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIPPED_DIRS.has(entry.name)) continue;
      walk(path, found);
      continue;
    }
    if (!entry.isFile()) continue;
    if (PROSE_EXTS.has(extname(entry.name).toLowerCase())) found.push(path);
  }
}

function documentsUnder(dir: string, seen: Set<string>): GroundDocument[] {
  if (!existsSync(dir)) return [];
  const paths: string[] = [];
  walk(dir, paths);
  const out: GroundDocument[] = [];
  for (const path of paths) {
    if (seen.has(path)) continue;
    seen.add(path);
    const title = firstHeading(path);
    out.push(title === undefined ? { path } : { path, title });
  }
  return out;
}

/**
 * Local documents first-run may seat from. Declared directory/git sources
 * that resolve on disk, then `<cwd>/docs` when cwd is provided.
 */
export function listVisibleGround(opts: {
  readonly sources: readonly Source[];
  readonly cwd?: string;
}): GroundDocument[] {
  const cwd = opts.cwd;
  const seen = new Set<string>();
  const found: GroundDocument[] = [];

  for (const source of opts.sources) {
    if (source.kind !== 'directory' && source.kind !== 'git') continue;
    if (source.kind === 'git' && isRemoteGitLocator(source.locator)) continue;
    const root = cwd === undefined ? source.locator : resolveLocator(source.locator, cwd);
    found.push(...documentsUnder(root, seen));
  }

  if (cwd !== undefined) {
    found.push(...documentsUnder(join(cwd, 'docs'), seen));
  }

  return found;
}
