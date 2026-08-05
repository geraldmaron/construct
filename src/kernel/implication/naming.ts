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
 * The seam. Given an outcome and the catalog to choose from, name the domains
 * it implicates. Implementations live outside the kernel (a host adapter, a
 * local model, a stub in tests) — this module never constructs one.
 */
export type DomainNamer = (
  outcome: string,
  catalog: readonly Domain[],
) => Promise<readonly DomainNaming[]>;

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
    return { ...fallback, inferredBy: fallback.implicated.length > 0 ? 'keywords' : 'none' };
  }

  const cached = input.cache?.get(input.outcome);
  if (cached) {
    return {
      outcome: input.outcome,
      implicated: cached,
      inferredBy: cached.length > 0 ? 'cache' : 'none',
    };
  }

  let namings: readonly DomainNaming[];
  try {
    namings = await input.namer(input.outcome, catalog);
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
    };
  }

  const implicated = admissible(Array.isArray(namings) ? namings : [], catalog);
  const limited = input.limit === undefined ? implicated : implicated.slice(0, input.limit);
  // A cached nothing is a real answer: the namer considered the catalog and
  // named nothing, and the same outcome must not pay to hear it twice.
  input.cache?.set(input.outcome, limited);
  return {
    outcome: input.outcome,
    implicated: limited,
    inferredBy: limited.length > 0 ? 'namer' : 'none',
  };
}
