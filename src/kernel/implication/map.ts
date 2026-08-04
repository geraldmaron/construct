/**
 * kernel/implication/map.ts — outcome in, implicated domains out. The head of
 * the Phase 2 spine (outcome -> implication map -> dispatch -> host adapter ->
 * deliverable) and the mechanism behind commitment 1: the system infers the
 * invisible roles without the user naming any of them.
 *
 * STRATEGY risk 1 says the honest version of this module is a measured one — if
 * the map underdelivers, the whole vision is a routing demo. So its quality is
 * a number with a pre-agreed target, checked in CI against a labeled outcome
 * set (tests/kernel/implication/fixtures/labeled-outcomes.json), not a claim
 * made here in prose.
 *
 * Scoring is the harvested dispatcher's, unchanged. This module contributes the
 * signal floor and the evidence trail, nothing else — a second matcher for the
 * same job is exactly the drift the glossary and commitment 16 exist to catch.
 */

import { matchingKeywords, suggestRoutes } from '../routing/dispatcher.ts';
import { DOMAINS, domainsByName } from './domains.ts';
import type { Domain } from './domains.ts';

/**
 * The signal floor. The dispatcher admits a route on any partial keyword match
 * (worth 3); a full keyword match is worth 10. Requiring 10 means one whole
 * signal must fire, so a single incidental word does not conscript a domain and
 * its role into the run. Raising this trades recall for precision — the labeled
 * set measures both, so the tradeoff is visible rather than assumed.
 */
export const MIN_SIGNAL = 10;

/**
 * The score at which every significant part of a keyword matched, rather than
 * some of them. Below this a keyword contributed to the score but is not honest
 * evidence for it.
 */
const FULL_MATCH = 7;

export interface Implication {
  readonly domain: string;
  readonly concern: string;
  /** How far above the floor this domain scored. */
  readonly score: number;
  /** The signals that fired, strongest first — the evidence for the inference. */
  readonly signals: readonly string[];
}

export interface MapInput {
  readonly outcome: string;
  readonly catalog?: readonly Domain[];
  readonly minSignal?: number;
  readonly limit?: number;
}

export interface ImplicationMap {
  readonly outcome: string;
  readonly implicated: readonly Implication[];
}

/**
 * Decompose an outcome into the domains it implicates.
 *
 * Returns them strongest first. An outcome that implicates nothing returns an
 * empty list rather than a default domain: inventing an implication is the same
 * class of failure as missing one, and commitment 15 forbids the invention half.
 */
export function mapImplications(input: MapInput): ImplicationMap {
  const catalog = input.catalog ?? DOMAINS;
  const minSignal = input.minSignal ?? MIN_SIGNAL;
  const outcome = input.outcome ?? '';
  const byName = domainsByName(catalog);

  const suggested = suggestRoutes({
    intent: outcome,
    routes: catalog,
    limit: catalog.length,
  });

  const implicated: Implication[] = [];
  for (const suggestion of suggested.suggestions) {
    const domain = byName.get(suggestion.domain ?? suggestion.path);
    if (!domain) continue;
    // suggestRoutes reports priority + keyword score; the signal strength is
    // what the keywords alone contributed.
    const signalScore = suggestion.score - (domain.priority ?? 1);
    if (signalScore < minSignal) continue;

    // The floor above is a sum, and partial matches are summable: six keywords
    // containing the word "data" scored 18 on an outcome that said "data" once,
    // clearing a floor documented as "one whole signal must fire" while citing
    // nothing (construct-4jq). That made catalog verbosity into score — the more
    // multi-word keywords a domain happens to list, the more partial credit one
    // incidental word earns it. Requiring a whole match makes the floor mean
    // what its comment says, and makes every implication carry the evidence the
    // Implication type promises: an inference nobody can argue with is the
    // citation half of commitment 15 failing on the map's own reasoning.
    const evidence = matchingKeywords(domain.keywords, outcome).filter((m) => m.score >= FULL_MATCH);
    if (evidence.length === 0) continue;

    implicated.push({
      domain: domain.domain,
      concern: domain.concern,
      score: signalScore,
      // Only whole-keyword matches are reported as evidence. A partial match
      // (one word of "next week" firing on "next month") legitimately
      // contributes to the score, but listing it as a signal would be the map
      // overstating why it inferred what it did — the citation half of
      // commitment 15 applied to its own reasoning. Non-empty by construction:
      // a domain with no whole match was skipped above.
      signals: evidence.map((m) => m.keyword),
    });
  }

  implicated.sort((a, b) => b.score - a.score || a.domain.localeCompare(b.domain));
  return {
    outcome,
    implicated: input.limit === undefined ? implicated : implicated.slice(0, input.limit),
  };
}

/** Just the domain names, for callers that only need the routing decision. */
export function implicatedDomains(input: MapInput): string[] {
  return mapImplications(input).implicated.map((i) => i.domain);
}
