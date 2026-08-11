/**
 * hosts/sources.ts — the IO half of grounding: what actually sits at a
 * declared source's locator.
 *
 * It lives under hosts/ for the reason the kernel seam exists: it stats and
 * walks paths the user supplied, and the kernel is forbidden the filesystem.
 * Every coverage judgment the walk feeds — complete, partial, unreachable —
 * is made in kernel/run/sourcereads.ts from this module's declared answer.
 *
 * Only local ground is walked: a directory, or a git checkout that is one. A
 * remote kind comes back unreachable with its reason, never silently skipped —
 * Construct builds no connectors, and a declared source nobody could read must
 * say so in the record rather than vanish from it.
 */

import { readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { UTF8_TEXT_EXTS, TRANSCRIPT_EXTS, EXTRACTABLE_DOCUMENT_EXTS } from '../kernel/extract/formats.ts';
import type { Source } from '../kernel/store/sources.ts';
import type { SourceSurvey, SurveyedDocument } from '../kernel/run/sourcereads.ts';

/**
 * The assignment carries every listed document by name, so the listing is
 * bounded: an unbounded walk over a real repository would bury the role's
 * prompt under the file inventory. What the cap drops is recorded as a
 * partial read, never absorbed.
 */
export const DOCUMENT_CAP = 40;

/** Directories that hold build output, dependencies, or history — never ground. */
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

/**
 * Prose ranks ahead of code when the cap bites: a role grounding a decision
 * wants the design document before the four-hundredth source file, and an
 * alphabetical walk of a repository would hand it the opposite.
 */
const PROSE_EXTS: ReadonlySet<string> = new Set(['.md', '.txt', '.rst', '.adoc', ...TRANSCRIPT_EXTS]);

const READABLE_EXTS: ReadonlySet<string> = new Set([...UTF8_TEXT_EXTS, ...TRANSCRIPT_EXTS]);

/**
 * Documents that exist and are not plain text: PDFs, office formats, images,
 * recordings. Surveyed rather than skipped, because a directory of PDFs that
 * surveys as zero documents is not a small ground, it is an invisible one —
 * and a role told the ground is empty writes with a confidence the walk never
 * earned. Whether the host can actually read one is the host's affair; the
 * survey's job is that the document exists on the record either way.
 */
const BINARY_EXTS: ReadonlySet<string> = new Set(
  [...EXTRACTABLE_DOCUMENT_EXTS].filter((ext) => !READABLE_EXTS.has(ext)),
);

function isRemoteGitLocator(locator: string): boolean {
  return /^(https?|git|ssh):\/\//.test(locator) || /^[\w.-]+@[\w.-]+:/.test(locator);
}

/**
 * Walk the locator, collecting readable documents. Sorted at every level so
 * the survey is deterministic, hidden entries and build-output directories
 * skipped, symlinks skipped so a cycle cannot hang a dispatch.
 */
function walk(dir: string, found: SurveyedDocument[]): void {
  const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    if (entry.isSymbolicLink()) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIPPED_DIRS.has(entry.name)) continue;
      walk(path, found);
      continue;
    }
    if (!entry.isFile()) continue;
    const ext = extname(entry.name).toLowerCase();
    if (READABLE_EXTS.has(ext)) {
      found.push({ path, bytes: statSync(path).size });
    } else if (BINARY_EXTS.has(ext)) {
      found.push({ path, bytes: statSync(path).size, binary: true });
    }
  }
}

/**
 * What one declared source holds. Never throws: a locator that cannot be read
 * is the unreachable answer, which is a result, not an error.
 */
export function surveySource(source: Source, opts?: { readonly cap?: number }): SourceSurvey {
  const cap = opts?.cap ?? DOCUMENT_CAP;
  const base = { source: source.id, locator: source.locator };

  if (source.kind !== 'directory' && source.kind !== 'git') {
    return {
      ...base,
      outcome: 'unreachable',
      reason:
        `no ${source.kind} connector — a remote source is read through the host, ` +
        'and this dispatch had no way to reach it',
    };
  }
  if (source.kind === 'git' && isRemoteGitLocator(source.locator)) {
    return {
      ...base,
      outcome: 'unreachable',
      reason: 'a remote git URL — declare the local checkout to ground runs in it',
    };
  }

  try {
    if (!statSync(source.locator).isDirectory()) {
      return { ...base, outcome: 'unreachable', reason: 'the locator is not a directory' };
    }
  } catch (error) {
    return { ...base, outcome: 'unreachable', reason: (error as Error).message };
  }

  const found: SurveyedDocument[] = [];
  try {
    walk(source.locator, found);
  } catch (error) {
    // A walk that died partway proves nothing about what it saw first: the
    // honest answer for the whole source is that it could not be read.
    return { ...base, outcome: 'unreachable', reason: (error as Error).message };
  }

  const ranked = [...found].sort((a, b) => {
    // Prose first, plain text next, binary last: when the cap bites, the
    // documents a role can definitely open outrank the ones it may not.
    const rank = (d: SurveyedDocument): number =>
      PROSE_EXTS.has(extname(d.path).toLowerCase()) ? 0 : d.binary ? 2 : 1;
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    return a.path.localeCompare(b.path);
  });

  return {
    ...base,
    outcome: 'listed',
    documents: ranked.slice(0, cap),
    total: found.length,
  };
}
