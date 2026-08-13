/**
 * kernel/context/produce.ts — the seam through which a host model turns a
 * recorded note into the context loop's inputs.
 *
 * Same division of labor as intake/densify.ts: the kernel defines the shape
 * and validates what came back; the model call lives in the host layer; a
 * failed producer is a stated stop, never a guess. The model reads the note,
 * the workspace's operational lessons, and its declared sources, and proposes
 * three sets — memory deltas, propagation proposals, drift observations. What
 * this module owns is the screen between the model's reply and the loop:
 *
 *   - A delta or proposal whose citation is not even the note-citation form
 *     is dropped here, with its reason kept, before the loop's hard gate ever
 *     sees it. The gate stays the backstop; this is the model hearing why.
 *   - An unstated risk is high risk. A proposal that did not say is not a
 *     proposal that said "low" — the same reasoning as the unrated domain.
 *   - Dropped items are returned, never swallowed, so the surface can show
 *     the user what the model proposed that did not survive.
 *
 * The challenger seam is commitment 5's adversarial pass, as a type: a delta
 * headed for auto-admission is first handed to a model told to refute it, and
 * the admission basis carries what that challenge found. Refuted is a real
 * answer — the delta is reported, not recorded.
 */

import { LESSON_KINDS, type LessonKind } from '../store/lessons.ts';
import { parseNoteCitation } from '../store/notes.ts';
import type { Observation, DriftCitation } from './observations.ts';

/** A lesson-to-be as the model proposed it, before ids, bases, or gates. */
export interface ProducedDelta {
  readonly kind: LessonKind;
  readonly domain: string;
  readonly body: string;
  readonly citation: string;
  readonly external: boolean;
}

/** An outward change as the model proposed it, before the rung 0 queue. */
export interface ProducedProposal {
  readonly source: string;
  readonly change: string;
  readonly justification: string;
  readonly risk: 'low' | 'high';
}

export interface ProducedLoop {
  readonly deltas: readonly ProducedDelta[];
  readonly proposals: readonly ProducedProposal[];
  readonly observations: readonly Observation[];
  /** What the model proposed that did not survive the screen, with reasons. */
  readonly discarded: readonly string[];
}

/** A model-backed producer. Throws on failure; the caller states the stop. */
/**
 * One declared source as the producer sees it. `documents` is what the survey
 * found, which is what a drift observation may cite; an empty listing means
 * the source could not be surveyed, not that it is empty, and the prompt says
 * which so a model does not read silence as an absence of documents.
 */
export interface ProducerSource {
  readonly id: string;
  readonly kind: string;
  readonly locator: string;
  readonly documents: readonly string[];
  /** Why the survey could not list this source, when it could not. */
  readonly unreachable?: string;
}

export type ContextProducer = (input: {
  readonly noteBody: string;
  readonly noteId: string;
  readonly lessons: readonly string[];
  readonly sources: readonly ProducerSource[];
}) => Promise<unknown>;

/** What an adversarial challenge of one delta concluded. */
export interface DeltaChallenge {
  readonly upheld: boolean;
  readonly detail: string;
}

/** A model told to refute a delta. Throws on failure; an unchallenged delta is held, not admitted. */
export type DeltaChallenger = (delta: ProducedDelta, citedLine: string) => Promise<DeltaChallenge>;

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function noteCitationOf(value: unknown, noteId: string): string | null {
  const citation = asString(value);
  const parsed = parseNoteCitation(citation);
  if (!parsed || parsed.note !== noteId) return null;
  return citation;
}

/**
 * Validate a parsed producer reply. Well-formed items pass; malformed items
 * are kept as reasons. The one coercion: a missing or unrecognized risk
 * becomes high, because "did not say" and "said low" are different facts.
 */
export function toProducedLoop(parsed: unknown, noteId: string): ProducedLoop {
  const record = parsed as {
    deltas?: unknown;
    proposals?: unknown;
    observations?: unknown;
  } | null;
  const list = (value: unknown): readonly unknown[] => (Array.isArray(value) ? value : []);
  const discarded: string[] = [];

  const deltas: ProducedDelta[] = [];
  for (const item of list(record?.deltas)) {
    const d = item as { kind?: unknown; domain?: unknown; body?: unknown; citation?: unknown; external?: unknown } | null;
    const body = asString(d?.body);
    const domain = asString(d?.domain);
    const kind = asString(d?.kind);
    const citation = noteCitationOf(d?.citation, noteId);
    if (!body || !domain) {
      discarded.push(`a delta with no ${body ? 'domain' : 'body'} was dropped`);
      continue;
    }
    if (!(LESSON_KINDS as readonly string[]).includes(kind)) {
      discarded.push(`delta "${body.slice(0, 60)}": unknown kind "${kind}" (kinds: ${LESSON_KINDS.join(', ')})`);
      continue;
    }
    if (!citation) {
      discarded.push(`delta "${body.slice(0, 60)}": its citation does not name a line of note ${noteId}`);
      continue;
    }
    deltas.push({ kind: kind as LessonKind, domain, body, citation, external: d?.external === true });
  }

  const proposals: ProducedProposal[] = [];
  for (const item of list(record?.proposals)) {
    const p = item as { source?: unknown; change?: unknown; justification?: unknown; risk?: unknown } | null;
    const source = asString(p?.source);
    const change = asString(p?.change);
    const justification = noteCitationOf(p?.justification, noteId);
    if (!source || !change) {
      discarded.push(`a proposal with no ${change ? 'source' : 'change'} was dropped`);
      continue;
    }
    if (!justification) {
      discarded.push(`proposal "${change.slice(0, 60)}": its justification does not name a line of note ${noteId}`);
      continue;
    }
    proposals.push({ source, change, justification, risk: p?.risk === 'low' ? 'low' : 'high' });
  }

  const observations = toObservations(record?.observations, PRODUCER_OBSERVER, discarded);

  return { deltas, proposals, observations, discarded };
}

/** The role recorded on an observation a note-driven producer pass made. */
export const PRODUCER_OBSERVER = 'context-producer';

/**
 * Parse a reply's observation list, attributing each to the pass that made it.
 * Shared by the note-driven producer and the note-free drift review, because
 * two parsers for one shape is two definitions of what a citation is.
 *
 * The reading pass never judges citations — the observation screen owns that,
 * including discarding the uncited — so a malformed citation is simply absent
 * here and the screen says what its absence means.
 */
export function toObservations(
  value: unknown,
  role: string,
  discarded: string[] = [],
): Observation[] {
  const observations: Observation[] = [];
  for (const item of Array.isArray(value) ? value : []) {
    const o = item as { claim?: unknown; citations?: unknown } | null;
    const claim = asString(o?.claim);
    if (!claim) {
      discarded.push('an observation with no claim was dropped');
      continue;
    }
    const citations: DriftCitation[] = [];
    for (const c of Array.isArray(o?.citations) ? o.citations : []) {
      const cite = c as { source?: unknown; document?: unknown } | null;
      const source = asString(cite?.source);
      const document = asString(cite?.document);
      if (source && document) citations.push({ source, document });
    }
    observations.push({ role, claim, citations });
  }
  return observations;
}
