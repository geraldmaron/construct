/**
 * kernel/implication/similarity.ts — the signal the keyword layer structurally
 * cannot carry.
 *
 * The keyword map's recall ceiling is dictionary coverage: a miss always closes
 * with a word nobody listed, and adding the word moves the failure to the next
 * unlisted word (escalate.ts's header states this; RESEARCH-DECISIONS.md §3
 * measures it — 116 of 207 keywords have never fired). Embedding similarity
 * between the outcome and each domain's concern sentence does not depend on any
 * word being listed, which is precisely the failure class it escapes.
 *
 * Measured before written (scripts/measure-decisions.mjs --section 5 records the
 * derived numbers): over all 540 (outcome, domain) pairs in the three corpora,
 * cosine similarity on a local nomic-embed-text ranks human-labeled pairs above
 * unlabeled ones with AUC 0.750 — a real signal and a poor classifier, the
 * distributions overlap heavily. But of the six labels the keyword pass misses,
 * ALL SIX rank in the top 4 of 10 domains by similarity, two of them first. So
 * this module is scoped to what the evidence supports: a SHORTLIST for
 * escalation to interrogate, and an uncertainty signal — never an implicator.
 * Similarity alone surfaces nothing; commitment 15's citation bar stays where
 * it is, because "the vectors were close" is not evidence a user can argue with.
 *
 * The embedder is injected exactly like Paths, the clock, and the namer. This
 * module imports no host, knows no vendor, and does no I/O of its own.
 */

import type { Domain } from './domains.ts';

/**
 * The seam. Text in, vector out. Implementations live outside the kernel — a
 * host adapter over a local model, a stub in tests. Dimension is the
 * implementation's business; this module only compares like with like.
 */
export type Embedder = (text: string) => Promise<readonly number[]>;

/** One domain's similarity to an outcome, with its rank among the catalog. */
export interface DomainSimilarity {
  readonly domain: string;
  readonly concern: string;
  /** Cosine similarity in [-1, 1]. Comparable only within one embedder. */
  readonly similarity: number;
  /** 1-based rank within the catalog, highest similarity first. */
  readonly rank: number;
}

export interface SimilarityInput {
  readonly outcome: string;
  readonly catalog: readonly Domain[];
  readonly embedder: Embedder;
}

/**
 * What a domain is embedded AS: its name plus its concern sentence — the text a
 * catalog author already wrote for a human reader, not a keyword list. Keeping
 * this in one exported function pins the corpus and the runtime to the same
 * representation; two call sites composing the string independently is how the
 * measurement quietly stops measuring the deployed thing.
 */
export function domainText(domain: Domain): string {
  return `${domain.domain}: ${domain.concern}`;
}

function cosine(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length || a.length === 0) {
    throw new RangeError(`cannot compare vectors of length ${a.length} and ${b.length}`);
  }
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  const norm = Math.sqrt(na) * Math.sqrt(nb);
  if (norm === 0) throw new RangeError('cannot compare a zero vector');
  return dot / norm;
}

/**
 * Rank every catalog domain by embedding similarity to the outcome.
 *
 * One embedder call per domain plus one for the outcome, sequentially — the
 * catalog is ten entries and the embedder is expected to be local; a
 * parallelism knob here would be tuning before measuring. Callers that price
 * embedder calls cache domain vectors themselves: domains change on catalog
 * edits, not per outcome.
 */
export async function rankBySimilarity(input: SimilarityInput): Promise<DomainSimilarity[]> {
  const outcomeVec = await input.embedder(input.outcome);
  const scored: { domain: Domain; similarity: number }[] = [];
  for (const domain of input.catalog) {
    const vec = await input.embedder(domainText(domain));
    scored.push({ domain, similarity: cosine(outcomeVec, vec) });
  }
  scored.sort(
    (a, b) => b.similarity - a.similarity || a.domain.domain.localeCompare(b.domain.domain),
  );
  return scored.map((s, i) => ({
    domain: s.domain.domain,
    concern: s.domain.concern,
    similarity: s.similarity,
    rank: i + 1,
  }));
}

/**
 * The escalation shortlist: the top-k domains by similarity that the keyword
 * pass did NOT implicate. These are the candidates worth spending a namer call
 * on — the measured basis for k=4 is that it covers all six keyword-missed
 * labels across the three corpora, and that number should be re-derived, not
 * trusted, when the corpus grows.
 *
 * Deliberately returns candidates for a namer to judge, never implications: a
 * shortlist admits domains on geometry, and geometry is not a citation.
 */
export function shortlist(
  ranked: readonly DomainSimilarity[],
  alreadyImplicated: readonly string[],
  k: number,
): DomainSimilarity[] {
  if (!Number.isInteger(k) || k < 0) throw new RangeError(`k must be a non-negative integer, got ${k}`);
  const implicated = new Set(alreadyImplicated);
  return ranked.filter((r) => !implicated.has(r.domain)).slice(0, k);
}
