/**
 * kernel/implication/escalate.ts — what to do when the deterministic map says
 * nothing (construct-4jq).
 *
 * The keyword map is fast, free, deterministic, and has a recall ceiling that
 * more dictionary does not raise: it only moves which wording fails. Measured,
 * the misses each close with a word — "raffle", "voice software", plain "data".
 * Adding those words passes those outcomes and loses the next ten.
 *
 * The failure that actually breaks the spine is narrower than the miss rate
 * suggests. A partially-implicated outcome still queues tasks and still reaches
 * a human; an outcome implicating NOTHING queues nothing, runs nothing, and the
 * user is told their outcome touched no domain — which is a confident wrong
 * answer, the one shape commitment 15 forbids. So escalation is scoped to
 * exactly that case: the keyword pass runs first and unescalated, and a model
 * is consulted only when the deterministic answer is silence.
 *
 * Three properties this seam is built to keep:
 *
 *   - The kernel stays ignorant of hosts. The namer is injected, exactly like
 *     Paths and the clock. This module imports no adapter and knows no vendor.
 *   - Escalation cannot invent a domain. Anything the namer returns that is not
 *     in the catalog is discarded, and a namer that throws degrades to silence
 *     rather than to a guess. Failing closed costs a run; failing open costs
 *     the user's trust in every run.
 *   - How an implication was reached travels with it. `inferredBy` is on the
 *     result and escalated implications carry the model's stated reason as
 *     their signal, because an inference a user cannot argue with is the defect
 *     this bead started from and a model-stated one is no exception.
 *
 * construct-2jb.12 adds one more input, optional and additive: when both a
 * namer AND an embedder are supplied, the namer is not handed the whole
 * catalog to judge — it is handed the top-k domains by embedding similarity
 * to the outcome (similarity.ts's shortlist). This is a narrowing of WHAT THE
 * NAMER LOOKS AT, never a substitute for its judgment: the namer still names
 * domains and still states why, `admissible()` still validates against the
 * full catalog, and no similarity value is ever written into an Implication.
 * A shortlist is a candidate list, not a citation (similarity.ts's header).
 * An embedder that throws degrades this to exactly today's behavior — the
 * namer sees the full catalog, as if no embedder had been supplied at all.
 */

import { mapImplications } from './map.ts';
import type { Implication, ImplicationMap } from './map.ts';
import { DOMAINS, domainsByName } from './domains.ts';
import type { Domain } from './domains.ts';
import { rankBySimilarity, shortlist } from './similarity.ts';
import type { Embedder } from './similarity.ts';

/** A domain the namer says is implicated, and why it says so. */
export interface DomainNaming {
  readonly domain: string;
  /** The namer's stated reason. Becomes the implication's cited evidence. */
  readonly why: string;
}

/**
 * The seam. Given an outcome and the catalog to choose from, name the domains
 * it implicates. Implementations live outside the kernel (a host adapter, a
 * local model, a stub in tests) — this module never constructs one.
 */
export type DomainNamer = (
  outcome: string,
  catalog: readonly Domain[],
) => Promise<readonly DomainNaming[]>;

/**
 * Escalation costs a model call, and the same outcome should not pay twice.
 * Deliberately an interface rather than a Map: the CLI can back it with the
 * store so the cost is not re-paid across processes, and tests can watch it.
 */
export interface EscalationCache {
  get(outcome: string): readonly Implication[] | undefined;
  set(outcome: string, implications: readonly Implication[]): void;
}

export type InferredBy = 'keywords' | 'escalation' | 'cache' | 'none';

export interface EscalatedMap extends ImplicationMap {
  /**
   * 'keywords' — the deterministic pass answered and nothing was escalated.
   * 'escalation' — the deterministic pass was silent and a namer answered.
   * 'cache' — a previous escalation for this exact outcome answered.
   * 'none' — nobody could name a domain. Reported, never papered over.
   */
  readonly inferredBy: InferredBy;
}

export interface EscalateInput {
  readonly outcome: string;
  readonly catalog?: readonly Domain[];
  readonly minSignal?: number;
  readonly limit?: number;
  /** Absent means no escalation: the map behaves exactly as it always has. */
  readonly namer?: DomainNamer;
  readonly cache?: EscalationCache;
  /**
   * Absent, or present without a namer, means no shortlisting: the namer (if
   * any) is handed the full catalog, exactly as before this bead. Present
   * alongside a namer, it narrows what the namer is asked to judge to the
   * domains geometry says are closest — never an implication signal itself.
   */
  readonly embedder?: Embedder;
}

/**
 * How many of the catalog's top-similarity domains the namer is shown when
 * escalating. Derived from the three measured corpora, not chosen: it is the
 * smallest k that covered every keyword-missed label in that measurement
 * (RESEARCH-DECISIONS.md §5.5). Re-derive it — do not just bump it — when the
 * corpus grows (construct-2jb.4):
 *
 *   node scripts/measure-decisions.mjs --embeddings --section 5.5
 *
 * and read the "smallest k covering every keyword-missed label" line.
 */
export const SHORTLIST_K = 4;

/**
 * Narrow the catalog a namer is asked to judge to the top SHORTLIST_K domains
 * by embedding similarity, when an embedder is available. Any failure here —
 * a missing embedder, an unreachable host, a bad response — returns the full
 * catalog unchanged: the shortlist is an enhancement to escalation, and a
 * broken enhancement must fall back to the behavior that shipped before it,
 * never surface a narrowed-and-therefore-wrong candidate set.
 */
async function candidateCatalog(
  outcome: string,
  catalog: readonly Domain[],
  embedder: Embedder | undefined,
): Promise<readonly Domain[]> {
  if (!embedder) return catalog;
  try {
    const ranked = await rankBySimilarity({ outcome, catalog, embedder });
    // Nothing is implicated yet in this branch (mapImplicationsEscalating
    // only reaches here when the deterministic pass was silent), so nothing
    // needs excluding from the shortlist.
    const candidates = shortlist(ranked, [], SHORTLIST_K);
    if (candidates.length === 0) return catalog;
    const byName = domainsByName(catalog);
    const narrowed = candidates
      .map((c) => byName.get(c.domain))
      .filter((d): d is Domain => d !== undefined);
    return narrowed.length > 0 ? narrowed : catalog;
  } catch {
    return catalog;
  }
}

/**
 * Escalated implications carry no keyword score, because no keyword produced
 * them. Reporting a number here would invite comparison with scores that mean
 * something else entirely.
 */
const NO_KEYWORD_SCORE = 0;

/**
 * Keep only namings the catalog actually contains, de-duplicated, in catalog
 * order. A namer that returns a domain nobody defined is not extending the
 * catalog — it is hallucinating a role, and dispatching to it would be the
 * invention half of commitment 15.
 */
function admissible(
  namings: readonly DomainNaming[],
  catalog: readonly Domain[],
): Implication[] {
  const byName = domainsByName(catalog);
  const seen = new Set<string>();
  const kept: Implication[] = [];
  for (const naming of namings) {
    const domain = byName.get(naming.domain);
    if (!domain || seen.has(domain.domain)) continue;
    const why = typeof naming.why === 'string' ? naming.why.trim() : '';
    // Same bar as the keyword path: an implication with nothing to cite does
    // not surface. A namer that will not say why has not given a reason.
    if (!why) continue;
    seen.add(domain.domain);
    kept.push({
      domain: domain.domain,
      concern: domain.concern,
      score: NO_KEYWORD_SCORE,
      signals: [why],
    });
  }
  return kept;
}

/**
 * Map an outcome to its domains, consulting a namer only if the deterministic
 * pass is silent.
 *
 * The common case does no I/O and costs nothing: when keywords answer, this
 * returns their answer unchanged and never touches the namer or the cache.
 */
export async function mapImplicationsEscalating(input: EscalateInput): Promise<EscalatedMap> {
  const catalog = input.catalog ?? DOMAINS;
  const deterministic = mapImplications({
    outcome: input.outcome,
    catalog,
    minSignal: input.minSignal,
    limit: input.limit,
  });

  if (deterministic.implicated.length > 0) {
    return { ...deterministic, inferredBy: 'keywords' };
  }
  if (!input.namer) {
    return { ...deterministic, inferredBy: 'none' };
  }

  const cached = input.cache?.get(input.outcome);
  if (cached) {
    return { outcome: input.outcome, implicated: cached, inferredBy: cached.length ? 'cache' : 'none' };
  }

  const namerCatalog = await candidateCatalog(input.outcome, catalog, input.embedder);

  let namings: readonly DomainNaming[];
  try {
    namings = await input.namer(input.outcome, namerCatalog);
  } catch {
    // A namer that fails is a namer that said nothing. The alternative —
    // surfacing a guess, or failing the whole outcome — trades a recoverable
    // silence for an unrecoverable wrong answer.
    return { outcome: input.outcome, implicated: [], inferredBy: 'none' };
  }

  const implicated = admissible(Array.isArray(namings) ? namings : [], catalog);
  const limited = input.limit === undefined ? implicated : implicated.slice(0, input.limit);
  input.cache?.set(input.outcome, limited);
  return {
    outcome: input.outcome,
    implicated: limited,
    inferredBy: limited.length > 0 ? 'escalation' : 'none',
  };
}
