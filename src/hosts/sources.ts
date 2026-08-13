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
 *
 * A document the walk cannot read as text is put into words here, through the
 * same extraction ladder a dropped note goes through, rather than being listed
 * and left. A ground of PDFs that a role can only see the filenames of reads
 * downstream as covered, which is the failure the extraction pass closes. The
 * extracted text is written under the cache root, and the material line points
 * the role at it while telling it to cite the original: an extraction is a
 * rendering of licensed evidence, not evidence of its own, so nothing about
 * what a run may cite changes.
 */

import { mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, join, extname } from 'node:path';
import { UTF8_TEXT_EXTS, TRANSCRIPT_EXTS, EXTRACTABLE_DOCUMENT_EXTS } from '../kernel/extract/formats.ts';
import type { Source } from '../kernel/store/sources.ts';
import type { SourceSurvey, SurveyedDocument, DocumentExtraction } from '../kernel/run/sourcereads.ts';
import { readSource, probeDocling, type DoclingProbe } from './extract.ts';

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
 * Every document under a directory, ranked as the survey ranks them: prose a
 * role can definitely open first, plain text next, binary last, deterministic
 * at every level. Exported because ingestion walks the same ground a survey
 * does, and two walks with different skip rules would mean a document that
 * grounds a run cannot be ingested, or the reverse.
 *
 * Throws what the filesystem throws: a directory that cannot be walked is the
 * caller's to report, and the survey's own answer for it is unreachable.
 */
export function listDocuments(dir: string): SurveyedDocument[] {
  const found: SurveyedDocument[] = [];
  walk(dir, found);
  return found.sort((a, b) => {
    const rank = (d: SurveyedDocument): number =>
      PROSE_EXTS.has(extname(d.path).toLowerCase()) ? 0 : d.binary ? 2 : 1;
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    return a.path.localeCompare(b.path);
  });
}

/**
 * Where one document's extracted text lives. Keyed by the document's absolute
 * path so re-surveying the same ground reuses the extraction instead of paying
 * a Docling spawn per run, and named with the original basename so a role
 * opening the file can tell what it is looking at.
 */
function extractionPathFor(cacheRoot: string, document: string): string {
  const digest = createHash('sha256').update(document).digest('hex').slice(0, 16);
  const stem = basename(document, extname(document)).replace(/[^\w.-]+/g, '-').slice(0, 60);
  return join(cacheRoot, `${stem}-${digest}.md`);
}

export interface ExtractOptions {
  /** Directory the extracted text is written under; created on demand. */
  readonly cacheRoot: string;
  /** Probed once by the caller and reused across every document in the walk. */
  readonly docling?: DoclingProbe;
}

/**
 * Put one binary document into words, or say why nothing could. A rung that
 * runs and a rung that refuses are both answers; only an exception would be a
 * surprise, so writing the extraction out is guarded too — a cache root that
 * cannot be written is a refusal, not a crash mid-survey.
 */
function extractDocument(document: string, opts: ExtractOptions, docling: DoclingProbe): DocumentExtraction {
  const read = readSource(document, { docling });
  if (!read.ok) {
    return { outcome: 'refused', reason: read.reason, remediation: read.remediation };
  }
  const path = extractionPathFor(opts.cacheRoot, document);
  try {
    mkdirSync(opts.cacheRoot, { recursive: true });
    writeFileSync(path, read.text);
  } catch (error) {
    return {
      outcome: 'refused',
      reason: `extracted by ${read.tier} but could not be written to ${path} — ${(error as Error).message}`,
      remediation: null,
    };
  }
  return { outcome: 'extracted', tier: read.tier, path, characters: read.text.length };
}

/**
 * What one declared source holds. Never throws: a locator that cannot be read
 * is the unreachable answer, which is a result, not an error.
 *
 * With `extract` given, every listed document the walk could not read as text
 * is run through the ladder. Only listed documents are extracted: paying for a
 * document the cap already dropped would buy words no role is going to see.
 */
export function surveySource(
  source: Source,
  opts?: { readonly cap?: number; readonly extract?: ExtractOptions },
): SourceSurvey {
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

  // Prose first, plain text next, binary last: when the cap bites, the
  // documents a role can definitely open outrank the ones it may not.
  let ranked: SurveyedDocument[];
  try {
    ranked = listDocuments(source.locator);
  } catch (error) {
    // A walk that died partway proves nothing about what it saw first: the
    // honest answer for the whole source is that it could not be read.
    return { ...base, outcome: 'unreachable', reason: (error as Error).message };
  }

  const listed = ranked.slice(0, cap);
  const extract = opts?.extract;
  let documents = listed;
  if (extract && listed.some((doc) => doc.binary)) {
    // Probed once for the whole source: the probe spawns a process, and one
    // spawn per PDF is the difference between a survey and a stall.
    const docling = extract.docling ?? probeDocling();
    documents = listed.map((doc) =>
      doc.binary ? { ...doc, extraction: extractDocument(doc.path, extract, docling) } : doc,
    );
  }

  return {
    ...base,
    outcome: 'listed',
    documents,
    total: ranked.length,
  };
}
