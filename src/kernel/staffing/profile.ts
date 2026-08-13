/**
 * kernel/staffing/profile.ts — what happens to a concern the catalog cannot
 * carry, once the run has stopped dropping it in silence.
 *
 * Both of the easy answers are wrong. Dropping the concern is the behavior the
 * unmet record replaced. Letting a model mint a domain on demand rebuilds the
 * predecessor's fifty-three role overlays, every one of them graded "strong" by
 * a static file rather than by a measurement, which is the failure that made
 * the predecessor compute its evidence tiers instead of asserting them.
 *
 * The middle path is a PROFILE that has to survive a gate and then be accepted
 * by a person. A profile names the concern and what a deliverable about it must
 * contain, states why each existing domain that claims its words does not
 * already cover it, and cites the practice its method descends from or says
 * honestly that it has none. What it never does is admit itself.
 *
 * THREE REFUSALS, EACH AN HONEST NO. A concern already carried by a domain that
 * claims its words is refused with that domain named. A concern requiring a
 * profession this catalog does not already answer to is refused outright,
 * because "we could staff anything" is the claim this module exists to not
 * make. A concern with no nameable practice and no stated reason for that
 * absence is refused, because a role invented out of nothing is the invention
 * half of commitment 15 wearing an org chart.
 *
 * THIS FAILS CLOSED, and it is the one ladder in the system that does. The
 * acquisition ladder proceeds on a labeled default because a draft that stalls
 * helps nobody. Admitting a domain is not like that: it changes routing for
 * every future run, so the default position in the inbox is NOT STAFFED and
 * silence leaves the catalog where it is.
 *
 * PER-ROLE DEPTH STAYS RETIRED. A profile is a coverage unit — something to
 * route to, attribute to, and hold obligations — and never a character for a
 * model to play. Nothing here claims that giving a role its own question set
 * makes its findings different from another role's; that claim was measured
 * and withdrawn.
 *
 * The near-neighbour check reuses the keyword map deliberately, and inherits
 * its known ceiling: the map's recall is bounded by dictionary coverage, so a
 * genuine neighbour whose words nobody listed will not be caught here. That
 * bound is why acceptance is a person's, not this function's.
 */

import { mapImplications } from '../implication/map.ts';
import { DOMAINS } from '../implication/domains.ts';
import type { Domain } from '../implication/domains.ts';
import { raiseDecision } from '../store/decisions.ts';
import type { Store } from '../store/open.ts';
import type { Slot } from '../plan/schema.ts';
import type { StandardRef } from '../plan/standards.ts';

/** Why an existing domain that claims the concern's words is not already it. */
export interface NearNeighbour {
  /** The catalog domain being rebutted, by its own name. */
  readonly domain: string;
  /** One line: what this domain would miss if it took the concern. */
  readonly whyNot: string;
}

/** A concern somebody proposes the catalog should carry. */
export interface StaffingProposal {
  /** The domain name proposed, in the catalog's own naming style. */
  readonly proposed: string;
  /** What this domain would be responsible for noticing, in one sentence. */
  readonly concern: string;
  /** The existing domains that claim these words, each rebutted by name. */
  readonly rebuttals: readonly NearNeighbour[];
  /** The practice the method descends from. Primary standards, never summaries. */
  readonly standards: readonly StandardRef[];
  /** Required exactly when `standards` is empty: why nothing could be named. */
  readonly ungrounded?: string;
  /** What a deliverable about this concern must contain to be sufficient. */
  readonly slots: readonly Slot[];
  /** The profession that must review this concern's output, when one must. */
  readonly licensedReview?: string;
}

/**
 * What is actually known about a profile at proposal time, which is little.
 *
 * 'grounded' — a practice is named, so the method has something to descend
 *              from and a reader has something to check it against.
 * 'unproven' — no practice was nameable and the absence is stated. Admissible,
 *              and labeled for as long as that stays true.
 *
 * There is deliberately no rung above these two. A tier that claims the
 * profile produces good findings would have to be earned by recorded runs, and
 * a function that has never seen one cannot award it.
 */
export type EvidenceTier = 'grounded' | 'unproven';

export interface AdmittedProfile extends StaffingProposal {
  readonly evidenceTier: EvidenceTier;
  /** What the tier rests on, so it never reads as a grade somebody gave. */
  readonly tierReason: string;
}

export type RefusalKind =
  | 'malformed'
  | 'already-covered'
  | 'licensed-profession'
  | 'no-practice-to-name';

export interface StaffingRefusal {
  readonly kind: RefusalKind;
  /** Said the way it would be said to the person who asked. */
  readonly reason: string;
  /** The domain that already covers it, present exactly on 'already-covered'. */
  readonly domain?: string;
}

export type StaffingOutcome =
  | { readonly admitted: AdmittedProfile; readonly refused?: undefined }
  | { readonly refused: StaffingRefusal; readonly admitted?: undefined };

/** The professions this catalog already answers to, read off the catalog. */
export function professionsCarried(catalog: readonly Domain[] = DOMAINS): Set<string> {
  return new Set(
    catalog.map((d) => d.licensedReview).filter((p): p is string => typeof p === 'string' && p !== ''),
  );
}

/**
 * The catalog domains whose keywords the proposed concern already trips.
 *
 * Exported because the refusal is only useful if the proposer can see what it
 * has to answer before it proposes.
 */
export function claimedBy(
  concern: string,
  catalog: readonly Domain[] = DOMAINS,
): readonly string[] {
  return mapImplications({ outcome: concern, catalog }).implicated.map((i) => i.domain);
}

const nonEmpty = (value: unknown): value is string =>
  typeof value === 'string' && value.trim() !== '';

/**
 * Run the gate. Returns the profile with its computed tier, or the refusal
 * with its reason — never both, and never a maybe.
 */
export function evaluateProfile(
  proposal: StaffingProposal,
  catalog: readonly Domain[] = DOMAINS,
): StaffingOutcome {
  const refuse = (kind: RefusalKind, reason: string, domain?: string): StaffingOutcome => ({
    refused: domain === undefined ? { kind, reason } : { kind, reason, domain },
  });

  if (!nonEmpty(proposal.proposed) || !nonEmpty(proposal.concern)) {
    return refuse('malformed', 'a profile needs a domain name and a concern sentence');
  }
  if (proposal.slots.length === 0) {
    return refuse(
      'malformed',
      `"${proposal.proposed}" names no slots, so nothing it produced could be checked for sufficiency`,
    );
  }

  const existing = catalog.find((d) => d.domain === proposal.proposed);
  if (existing) {
    return refuse(
      'already-covered',
      `the catalog already carries "${existing.domain}": ${existing.concern}`,
      existing.domain,
    );
  }

  // A profession the catalog has never answered to is the honest no. Construct
  // issue-spots and does not advise, and extending that to a new profession
  // would be claiming a competence nothing here has established.
  if (nonEmpty(proposal.licensedReview) && !professionsCarried(catalog).has(proposal.licensedReview)) {
    return refuse(
      'licensed-profession',
      `"${proposal.proposed}" requires review by a ${proposal.licensedReview}, a profession this ` +
        'catalog does not already answer to; construct cannot staff it, and the work needs that ' +
        'reviewer rather than a new role',
    );
  }

  const rebutted = new Set(proposal.rebuttals.filter((r) => nonEmpty(r.whyNot)).map((r) => r.domain));
  for (const claimant of claimedBy(proposal.concern, catalog)) {
    if (!rebutted.has(claimant)) {
      const domain = catalog.find((d) => d.domain === claimant);
      return refuse(
        'already-covered',
        `"${claimant}" already claims these words (${domain?.concern ?? 'concern not recorded'}); ` +
          'say what it would miss, or route the concern to it',
        claimant,
      );
    }
  }

  if (proposal.standards.length === 0 && !nonEmpty(proposal.ungrounded)) {
    return refuse(
      'no-practice-to-name',
      `"${proposal.proposed}" cites no practice and gives no reason for having none; a role with ` +
        'neither is invented rather than found',
    );
  }

  const grounded = proposal.standards.length > 0;
  return {
    admitted: {
      ...proposal,
      evidenceTier: grounded ? 'grounded' : 'unproven',
      tierReason: grounded
        ? `${proposal.standards.length} named practice(s) the method descends from; no run has ` +
          'exercised this profile, so nothing above grounded is claimed'
        : 'no practice was nameable and the absence is stated; the profile runs labeled until one is',
    },
  };
}

/** Two positions, because a one-sided question is a report, not a decision. */
export const NOT_STAFFED = 'not staffed: the catalog stays as it is and the concern stays unmet';

export interface ProposeStaffing {
  readonly id: string;
  readonly run: string;
  readonly profile: AdmittedProfile;
  /** The namer's own words that raised the concern, when a run raised it. */
  readonly raisedBy?: string;
  /** Injected; the kernel never reads the clock. */
  readonly at: string;
}

/**
 * Put an admitted profile in front of the person who decides, with the default
 * stated as its own position.
 *
 * The default is NOT STAFFED and the wording says so plainly. An inbox entry
 * whose unanswered state quietly widened the catalog would be the same silent
 * drift this whole path replaced, arriving one step later.
 */
export function proposeStaffing(store: Store, input: ProposeStaffing): void {
  const { profile } = input;
  const slots = profile.slots.map((s) => s.name).join(', ');
  const practice =
    profile.standards.length > 0
      ? profile.standards.map((s) => `${s.name} (${s.publisher})`).join('; ')
      : `no practice named: ${profile.ungrounded ?? 'reason not recorded'}`;
  raiseDecision(store, {
    id: input.id,
    run: input.run,
    question:
      `Should the catalog carry "${profile.proposed}" — ${profile.concern}?` +
      (input.raisedBy ? ` Raised by: ${input.raisedBy}` : ''),
    positions: [
      {
        role: 'staffing',
        stance:
          `staff it as "${profile.proposed}" (${profile.evidenceTier}): deliverables would owe ${slots}`,
        citation: practice,
      },
      {
        role: 'staffing',
        stance: NOT_STAFFED,
        citation: profile.rebuttals.map((r) => `${r.domain}: ${r.whyNot}`).join('; ') || null,
      },
    ],
    raisedAt: input.at,
  });
}
