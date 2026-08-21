/**
 * kernel/context/review.ts — the drift review: what disagrees inside a
 * workspace's declared ground, asked without a note to occasion it.
 *
 * The note loop already produced drift observations, but only ever as a side
 * effect of somebody dropping a call note. A person acting as program manager
 * over a documents repository has the opposite need — read what is there and
 * tell me what contradicts — and there was no way to ask for it.
 *
 * This module owns only the shape and the validation. The model call lives in
 * the host layer, the citation judgment stays in observations.ts, and the
 * survey that says which documents exist stays in the IO half. What is
 * deliberately absent is memory deltas and outward proposals: both justify
 * themselves by citing a line of a note, and a review has no note, so a review
 * that emitted them would be emitting conclusions with nothing to cite.
 */

import { toObservations } from './produce.ts';
import type { ProducerSource } from './produce.ts';
import { resolveListedDocument } from './observations.ts';
import type { Observation } from './observations.ts';

/** The role recorded on an observation a note-free review made. */
export const REVIEWER_ROLE = 'drift-reviewer';

/**
 * A model asked what disagrees across a set of surveyed documents. Throws on
 * failure the way every other host seam does: a review that could not be run
 * is a stated stop, never an empty result that reads as "nothing disagrees".
 */
export type DriftReviewer = (input: {
  readonly sources: readonly ProducerSource[];
}) => Promise<unknown>;

/**
 * One document the reviewer accounted for, and what it says became of the
 * read. A document the reviewer never mentions appears in neither outcome:
 * silence about a document is not a claim to have opened it.
 */
export interface DocumentRead {
  readonly document: string;
  readonly outcome: 'read' | 'unreadable';
  /** For an unreadable document, the reason the reviewer gave for that. */
  readonly detail: string;
}

export interface ReviewedDrift {
  readonly observations: readonly Observation[];
  /** Items the reading pass could not make sense of, each with its reason. */
  readonly discarded: readonly string[];
  /** The reviewer's own account of which listed documents it opened. */
  readonly reads: readonly DocumentRead[];
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Parse the reviewer's account of its own reading. Malformed entries are
 * dropped rather than guessed at: an entry naming no document is evidence of
 * nothing, and inventing a document for it would manufacture the one thing
 * this account exists to supply.
 */
function toDocumentReads(record: { read?: unknown; unreadable?: unknown } | null): DocumentRead[] {
  const reads: DocumentRead[] = [];
  for (const item of Array.isArray(record?.read) ? record.read : []) {
    const document = asText(typeof item === 'string' ? item : (item as { document?: unknown })?.document);
    if (document) reads.push({ document, outcome: 'read', detail: '' });
  }
  for (const item of Array.isArray(record?.unreadable) ? record.unreadable : []) {
    const entry = item as { document?: unknown; reason?: unknown } | null;
    const document = asText(typeof item === 'string' ? item : entry?.document);
    if (document) {
      reads.push({ document, outcome: 'unreadable', detail: asText(entry?.reason) || 'no reason given' });
    }
  }
  return reads;
}

/**
 * Validate a parsed reviewer reply. A shapeless reply is an empty review
 * rather than an error: the model answering "nothing disagrees" and the model
 * answering nothing at all are both handled downstream by a screen that
 * reports what it kept, and neither is a crash. What the shapeless reply is
 * not is a clean review — a reply carrying no reading account carries no
 * evidence any document was opened, which the caller reports rather than
 * absorbs.
 */
export function toReviewedDrift(parsed: unknown): ReviewedDrift {
  const record = parsed as { observations?: unknown; read?: unknown; unreadable?: unknown } | null;
  const discarded: string[] = [];
  return {
    observations: toObservations(record?.observations, REVIEWER_ROLE, discarded),
    discarded,
    reads: toDocumentReads(record),
  };
}

/**
 * What the review can show about its own reading of the ground.
 *
 * Construct surveys the ground itself, so the documents are its own evidence.
 * The reads are not: the reviewer opens them with the host's own tools and
 * their content never passes through Construct, so nothing here proves a
 * document was opened. What it does establish is the negative — a surveyed
 * document the reviewer's account never names is a document the review cannot
 * show it read, and a review that names none read nothing.
 */
export interface GroundReadEvidence {
  /** Every document the survey listed, across the sources it could reach. */
  readonly surveyed: readonly string[];
  /** Surveyed documents the reviewer accounts for having opened. */
  readonly read: readonly string[];
  /** Surveyed documents the reviewer says it could not open, with its reason. */
  readonly unreadable: readonly DocumentRead[];
  /** Surveyed documents the account names neither way. */
  readonly unaccounted: readonly string[];
}

/**
 * Screen a reviewer's reading account against the survey. A claimed read that
 * names nothing the survey listed counts for nothing — the same rule the
 * citation screen applies, for the same reason — so it leaves the surveyed
 * document it failed to name still unaccounted for.
 *
 * Sources nobody could survey contribute no documents and so no gap: they are
 * read through the host's own tools and there is no listing to check against,
 * which is the same exemption their citations get.
 */
export function groundReadEvidence(
  sources: readonly ProducerSource[],
  reads: readonly DocumentRead[],
): GroundReadEvidence {
  const listed = new Set<string>();
  for (const source of sources) {
    if (source.unreachable !== undefined) continue;
    for (const document of source.documents) listed.add(document);
  }

  const read = new Set<string>();
  const unreadable = new Map<string, DocumentRead>();
  for (const entry of reads) {
    const resolved = resolveListedDocument(entry.document, listed);
    if (resolved === null) continue;
    if (entry.outcome === 'read') read.add(resolved);
    else unreadable.set(resolved, { ...entry, document: resolved });
  }
  // Claimed both ways, the failure stands: "I could not open it" is the half
  // of the account that costs the reviewer something to say.
  for (const document of unreadable.keys()) read.delete(document);

  const surveyed = [...listed].sort();
  return {
    surveyed,
    read: surveyed.filter((document) => read.has(document)),
    unreadable: surveyed.filter((d) => unreadable.has(d)).map((d) => unreadable.get(d) as DocumentRead),
    unaccounted: surveyed.filter((document) => !read.has(document) && !unreadable.has(document)),
  };
}
