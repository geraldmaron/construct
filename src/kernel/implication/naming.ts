/**
 * kernel/implication/naming.ts — which domains an outcome implicates, model
 * first (adopted 2026-08-05 on the RESEARCH-DECISIONS.md §10
 * figures).
 *
 * This module replaced escalate.ts, and the order of consultation is the whole
 * difference. The shipped behavior used to be keywords first with a model
 * consulted only on silence; measured on wording authored by minds that never
 * saw the catalog, that ordering missed 0.398 while namer-first missed 0.301
 * and over-implicated less (0.188 vs 0.325). The keyword map's near-perfect
 * showing on its own tuning family is memorization, and no real user shares
 * it. So: when a namer is supplied it is consulted on EVERY outcome, and the
 * keyword map holds exactly two demoted duties —
 *
 *   - the zero-model fallback: no namer supplied (recording an outcome stays
 *     free), or the namer failed (a broken host must not take routing with it);
 *   - the evidence layer: keyword hits as corroborating signals in role task
 *     prompts, which lands with the dispatch-evidence work, not here.
 *
 * What ships here is exactly what §10 measured as configuration B, including
 * the edge that matters: a namer that SUCCEEDS and names nothing is an answer
 * ("this outcome implicates nothing"), not a failure — keywords do not
 * second-guess it. Only a namer that throws falls back, and that fallback is
 * reported on the result so the caller can log the degradation instead of
 * letting a keyword answer impersonate a model's.
 *
 * Three properties carried over from the seam this replaces, unchanged:
 *
 *   - The kernel stays ignorant of hosts. The namer is injected, exactly like
 *     Paths and the clock. This module imports no adapter and knows no vendor.
 *   - A namer cannot invent a domain. Anything it returns that is not in the
 *     catalog is discarded (admissible below) — it proposes, never certifies.
 *   - How an implication was reached travels with it. `inferredBy` is on the
 *     result, and named implications carry the model's stated reason as their
 *     signal, because an inference a user cannot argue with is the defect
 *     this inversion started from.
 *
 * The similarity shortlist that rode the old escalation path does not ride
 * this one: §10's figures were measured with the namer reading the full
 * catalog, and shipping a narrowed variant would ship an unmeasured behavior
 * wearing measured numbers. similarity.ts remains for measurement.
 */

import { mapImplications } from './map.ts';
import type { Implication, ImplicationMap } from './map.ts';
import { DOMAINS, domainsByName } from './domains.ts';
import type { Domain } from './domains.ts';

/** A domain the namer says is implicated, and why it says so. */
export interface DomainNaming {
  readonly domain: string;
  /** The namer's stated reason. Becomes the implication's cited evidence. */
  readonly why: string;
}

/**
 * Why a proposed naming did not become an implication.
 *
 * 'not-in-catalog'  — the namer read the outcome and named a concern this
 *                     catalog does not carry. The most informative of the
 *                     four: it is the catalog's own coverage gap, stated in
 *                     the words of a model that had just read the user's.
 * 'no-reason-given' — named without a why. Nothing to cite, so nothing to
 *                     argue with, so it does not surface.
 * 'duplicate'       — the same domain named twice; the first naming stands.
 * 'over-limit'      — admitted, then cut by the caller's limit. The concern
 *                     was real and the run simply would not carry that many.
 */
export type UnmetReason = 'not-in-catalog' | 'no-reason-given' | 'duplicate' | 'over-limit';

/**
 * A concern the namer raised that the run will not act on, kept with the
 * reason it was refused.
 *
 * Discarding these was correct and still is: a namer cannot extend the
 * catalog, and dispatching to a domain nobody defined is the invention half of
 * commitment 15. Discarding them SILENTLY was the defect. A run whose namer
 * proposed four concerns the catalog cannot carry, and a run whose catalog
 * covered the outcome exactly, produced the same record and read the same to
 * the user. Now they do not.
 *
 * Nothing here changes routing. An unmet concern is a report about the
 * catalog, never a role, and no dispatch reads this field.
 */
export interface UnmetConcern {
  /** The domain the namer proposed, verbatim, including a name nobody defined. */
  readonly proposed: string;
  /** The namer's stated reason, empty exactly when that is what refused it. */
  readonly why: string;
  readonly reason: UnmetReason;
}

/**
 * A namer's answer when it has more to say than the namings themselves: a
 * malformed first reply that a corrective retry repaired is a fact the work
 * log must be able to show, because the repair cost a second model call.
 */
export interface NamerReply {
  readonly namings: readonly DomainNaming[];
  /** True when the answer came from a corrective retry after a parse failure. */
  readonly retried?: boolean;
  /** The first reply's parse failure, present exactly when `retried` is true. */
  readonly firstFailure?: string;
}

/**
 * The seam. Given an outcome and the catalog to choose from, name the domains
 * it implicates. Implementations live outside the kernel (a host adapter, a
 * local model, a stub in tests) — this module never constructs one. A bare
 * array and a `NamerReply` with no `retried` mean the same thing; the object
 * form exists so a repaired answer can report itself.
 */
export type DomainNamer = (
  outcome: string,
  catalog: readonly Domain[],
) => Promise<readonly DomainNaming[] | NamerReply>;

/**
 * A namer consultation costs a model call, and the same outcome should not pay
 * twice. Deliberately an interface rather than a Map: the CLI backs it with
 * the store so the cost is not re-paid across processes, and tests can watch
 * it.
 */
export interface NamingCache {
  get(outcome: string): readonly Implication[] | undefined;
  set(outcome: string, implications: readonly Implication[]): void;
}

export type InferredBy = 'namer' | 'keywords' | 'cache' | 'none' | 'user';

export interface NamedMap extends ImplicationMap {
  /**
   * 'namer'    — a model read the outcome and named these (the primary path).
   * 'keywords' — the zero-model fallback answered: no namer was supplied, or
   *              the namer failed and the map caught the run.
   * 'cache'    — a previous consultation for this exact outcome answered.
   * 'user'     — the user named the domains outright; nothing was inferred.
   * 'none'     — nobody named a domain. Reported, never papered over.
   */
  readonly inferredBy: InferredBy;
  /**
   * Present exactly when a namer was supplied and threw: the message of what
   * went wrong, so the caller can record that a keyword answer stands in for a
   * model's rather than letting it impersonate one. Absent on every other
   * path, including a namer that legitimately named nothing.
   */
  readonly namerFailure?: string;
  /**
   * Present exactly when the namer answered only after a corrective retry:
   * the first reply's parse failure. A repaired answer is still the namer's
   * answer, but it cost a second model call and the log says so.
   */
  readonly namerRetriedAfter?: string;
  /**
   * Concerns the namer raised that this run will not act on, each with the
   * reason. Empty on every path where nothing was proposed, and empty on a
   * cache hit — the consultation that filled the cache recorded its own unmet
   * concerns against that outcome at the time, and repeating them here would
   * claim a second reading that never happened.
   */
  readonly unmet: readonly UnmetConcern[];
}

export interface NameInput {
  readonly outcome: string;
  readonly catalog?: readonly Domain[];
  readonly minSignal?: number;
  readonly limit?: number;
  /** Absent means the zero-model fallback: the keyword map alone answers. */
  readonly namer?: DomainNamer;
  readonly cache?: NamingCache;
}

/**
 * Named implications carry no keyword score, because no keyword produced
 * them. Reporting a number here would invite comparison with scores that mean
 * something else entirely.
 */
const NO_KEYWORD_SCORE = 0;

/**
 * Keep only namings the catalog actually contains, de-duplicated, in the
 * order the namer gave them. A namer that returns a domain nobody defined is
 * not extending the catalog — it is hallucinating a role, and dispatching to
 * it would be the invention half of commitment 15.
 *
 * The refusals come back beside what was kept. What is refused is a fact about
 * the catalog rather than about the namer, and a caller that cannot see it
 * cannot tell a covered outcome from an uncovered one.
 */
function admissible(
  namings: readonly DomainNaming[],
  catalog: readonly Domain[],
): { readonly kept: Implication[]; readonly unmet: UnmetConcern[] } {
  const byName = domainsByName(catalog);
  const seen = new Set<string>();
  const kept: Implication[] = [];
  const unmet: UnmetConcern[] = [];
  for (const naming of namings) {
    const proposed = typeof naming.domain === 'string' ? naming.domain.trim() : '';
    const why = typeof naming.why === 'string' ? naming.why.trim() : '';
    const domain = byName.get(proposed);
    if (!domain) {
      // The catalog's coverage gap, in the words of a model that had just read
      // the user's. Kept under the name the namer used, unaltered: a proposal
      // normalized toward a name the catalog already has would read as a near
      // miss when it may be a concern nobody has staffed.
      unmet.push({ proposed, why, reason: 'not-in-catalog' });
      continue;
    }
    if (seen.has(domain.domain)) {
      unmet.push({ proposed: domain.domain, why, reason: 'duplicate' });
      continue;
    }
    // Same bar as the keyword path: an implication with nothing to cite does
    // not surface. A namer that will not say why has not given a reason.
    if (!why) {
      unmet.push({ proposed: domain.domain, why: '', reason: 'no-reason-given' });
      continue;
    }
    seen.add(domain.domain);
    kept.push({
      domain: domain.domain,
      concern: domain.concern,
      score: NO_KEYWORD_SCORE,
      signals: [why],
    });
  }
  return { kept, unmet };
}

/**
 * Map an outcome to its domains: the namer primary when supplied, the keyword
 * map as the zero-model fallback.
 *
 * Without a namer this does no I/O and costs nothing — the map answers or it
 * does not, exactly as it always has. With one, every outcome is a model
 * consultation (cached per outcome), because the measured alternative only
 * worked on wording its own authors had already imagined.
 */
export async function mapImplicationsNamed(input: NameInput): Promise<NamedMap> {
  const catalog = input.catalog ?? DOMAINS;
  const keywords = (): ImplicationMap =>
    mapImplications({
      outcome: input.outcome,
      catalog,
      minSignal: input.minSignal,
      limit: input.limit,
    });

  if (!input.namer) {
    const fallback = keywords();
    // The keyword map draws from the catalog and cannot propose outside it, so
    // it has no unmet concerns to report. Its silence is a different thing
    // from a namer's silence and must not be dressed up as the same evidence.
    return { ...fallback, inferredBy: fallback.implicated.length > 0 ? 'keywords' : 'none', unmet: [] };
  }

  const cached = input.cache?.get(input.outcome);
  if (cached) {
    return {
      outcome: input.outcome,
      implicated: cached,
      inferredBy: cached.length > 0 ? 'cache' : 'none',
      unmet: [],
    };
  }

  let namings: readonly DomainNaming[];
  let retriedAfter: string | undefined;
  try {
    const reply = await input.namer(input.outcome, catalog);
    if ('namings' in reply) {
      namings = reply.namings;
      if (reply.retried) {
        retriedAfter = reply.firstFailure ?? 'the first reply could not be parsed';
      }
    } else {
      namings = reply;
    }
  } catch (error) {
    // The zero-model fallback catches the run — §10's configuration B fell
    // back exactly here — but the substitution is stated, never silent: a
    // keyword answer standing in for a model's is a degradation the work log
    // must be able to show.
    const fallback = keywords();
    return {
      ...fallback,
      inferredBy: fallback.implicated.length > 0 ? 'keywords' : 'none',
      namerFailure: (error as Error)?.message ?? String(error),
      unmet: [],
    };
  }

  const { kept, unmet } = admissible(Array.isArray(namings) ? namings : [], catalog);
  const limited = input.limit === undefined ? kept : kept.slice(0, input.limit);
  // A concern cut by the limit was admitted on its merits and lost to a cap.
  // That is a different fact from a concern the catalog cannot carry, and the
  // reason code keeps them apart wherever this is read.
  const cut = kept.slice(limited.length).map(
    (implication): UnmetConcern => ({
      proposed: implication.domain,
      why: implication.signals[0] ?? '',
      reason: 'over-limit',
    }),
  );
  // A cached nothing is a real answer: the namer considered the catalog and
  // named nothing, and the same outcome must not pay to hear it twice.
  input.cache?.set(input.outcome, limited);
  return {
    outcome: input.outcome,
    implicated: limited,
    inferredBy: limited.length > 0 ? 'namer' : 'none',
    ...(retriedAfter !== undefined ? { namerRetriedAfter: retriedAfter } : {}),
    unmet: [...unmet, ...cut],
  };
}
