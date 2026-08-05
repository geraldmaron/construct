/**
 * kernel/challenge/catalog.ts — the challenges a brief may name, and the ones
 * a machine can check for free.
 *
 * Commitment 13: adversarial challenge is an obligation, not a courtesy. A brief
 * names the challenges its deliverable must satisfy before promoting past
 * draft, deterministic structural checks run always and free, and a
 * second-role substantive pass runs only where the brief's heat warrants it.
 *
 * The half that existed before this module: briefs could declare challenges,
 * and promotion derived its state from recorded verdicts. Nothing ran. A brief
 * could require `pre-mortem` and the requirement was satisfied by nobody
 * noticing, which is worse than not declaring it, because the declaration
 * reads as a control.
 *
 * WHAT A STRUCTURAL CHECK IS, AND IS NOT. It answers "was this work done and
 * shown", never "is the argument any good". A checker can see that a
 * deliverable states its strongest objection under a label; it cannot tell
 * whether the objection is the strongest one, or even a real one. That
 * judgement is the substantive pass, it costs a model call, and pretending a
 * free check delivers it would be the fabricated assurance this project exists
 * not to make. So a structural pass is reported for exactly what it is, and a
 * challenge with no structural checker is never recorded as passed — it stays
 * unanswered until something that can judge it answers.
 *
 * The checks are deliberately generous about form and strict about presence.
 * Models write "## Strongest objection", "**The strongest objection:**", and
 * "Strongest counter-argument -" for the same instruction, and a checker that
 * demanded one spelling would fail honest work while teaching everyone to
 * format for the checker rather than to think.
 */

import { findUntaggedClaims } from '../verify/claims.ts';
import type { Brief } from '../brief/schema.ts';

export interface ChallengeCheck {
  /** True when the deliverable shows the work this challenge asks for. */
  readonly passed: boolean;
  /** What was looked for and what was found, for the record and the role. */
  readonly detail: string;
}

export interface Challenge {
  readonly id: string;
  /** What the challenge asks of the deliverable, in one sentence. */
  readonly question: string;
  /**
   * A free, deterministic check for the presence of the work, or null when
   * only a substantive pass can answer this challenge.
   */
  readonly structural: ((deliverable: string, brief: Brief) => ChallengeCheck) | null;
}

/** Any of these labels, however the model decorated them, counts as present. */
function labelled(text: string, labels: readonly string[]): boolean {
  const flattened = text.toLowerCase().replace(/[*_`#>]/g, ' ').replace(/\s+/g, ' ');
  return labels.some((label) => flattened.includes(label));
}

function found(passed: boolean, looked: string, detail: string): ChallengeCheck {
  return { passed, detail: passed ? `${looked}: ${detail}` : `${looked}: not found` };
}

export const CHALLENGES: readonly Challenge[] = [
  {
    id: 'strongest-objection',
    question: 'What is the strongest argument against this, stated in its own words?',
    structural: (deliverable) =>
      found(
        labelled(deliverable, [
          'strongest objection',
          'strongest argument against',
          'strongest counter',
          'best argument against',
          'the case against',
        ]),
        'a labelled strongest objection',
        'present — whether it is genuinely the strongest is a substantive question this check cannot answer',
      ),
  },
  {
    id: 'pre-mortem',
    question: 'Assume this failed. What is the most likely story of how?',
    structural: (deliverable) =>
      found(
        labelled(deliverable, ['pre-mortem', 'premortem', 'assume this failed', 'how this fails']),
        'a labelled pre-mortem',
        'present — the plausibility of the failure story is a substantive question',
      ),
  },
  {
    id: 'claims-cited',
    question: 'Does every load-bearing claim carry a citation or an [unverified] tag?',
    // The one challenge a machine can answer completely, and it already had an
    // implementation before this catalog existed. Reused rather than rewritten:
    // a second matcher for the same job is the drift commitment 16 exists to
    // catch, and two of them would disagree eventually.
    structural: (deliverable) => {
      const untagged = findUntaggedClaims(deliverable);
      if (untagged.length === 0) {
        return { passed: true, detail: 'every amount, percentage, and date carries a citation or an [unverified] tag' };
      }
      const shown = untagged.slice(0, 3).map((c) => `line ${String(c.line)}`).join(', ');
      const more = untagged.length > 3 ? ` (and ${String(untagged.length - 3)} more)` : '';
      return {
        passed: false,
        detail: `${String(untagged.length)} claim(s) carry neither a citation nor an [unverified] tag: ${shown}${more}`,
      };
    },
  },
  {
    id: 'scope-diff',
    question: 'What did the brief ask for that this deliverable does not cover?',
    structural: (deliverable) =>
      found(
        labelled(deliverable, [
          'out of scope',
          'not covered',
          'scope diff',
          'did not cover',
          'could not determine',
          'cannot determine',
        ]),
        'a stated gap between the brief and the deliverable',
        'present — a deliverable that names nothing it left uncovered is claiming complete coverage',
      ),
  },
  {
    id: 'legal-issue-spot',
    question: 'Has a legal issue-spotting pass read this deliverable?',
    // No structural form exists. Whether a legal issue was spotted is exactly
    // the judgement a check cannot make, and a presence test here would let a
    // deliverable promote because it contained the word "legal".
    structural: null,
  },
];

const BY_ID = new Map(CHALLENGES.map((challenge) => [challenge.id, challenge]));

export function challengeById(id: string): Challenge | undefined {
  return BY_ID.get(id);
}

export interface StructuralResult {
  readonly challenge: string;
  readonly passed: boolean;
  readonly detail: string;
}

export interface UnansweredChallenge {
  readonly challenge: string;
  /** Why nothing was recorded: no structural form, or no such challenge. */
  readonly reason: string;
}

export interface StructuralRun {
  readonly results: readonly StructuralResult[];
  /** Declared challenges nothing here could answer. Never treated as passed. */
  readonly unanswered: readonly UnansweredChallenge[];
}

/**
 * Run every structural check the brief declared, over one deliverable.
 *
 * A challenge the brief did not declare is not run: commitment 10 puts the
 * declaration on the brief, and a dispatcher that ran checks nobody asked for
 * would be deciding the obligation itself.
 */
export function runStructuralChallenges(brief: Brief, deliverable: string): StructuralRun {
  const results: StructuralResult[] = [];
  const unanswered: UnansweredChallenge[] = [];

  for (const id of brief.challenges ?? []) {
    const challenge = challengeById(id);
    if (!challenge) {
      unanswered.push({
        challenge: id,
        reason: `no challenge named "${id}" — it stays unanswered rather than passing by default`,
      });
      continue;
    }
    if (!challenge.structural) {
      unanswered.push({
        challenge: id,
        reason: 'no free structural form: this one needs a substantive pass to answer',
      });
      continue;
    }
    const check = challenge.structural(deliverable, brief);
    results.push({ challenge: id, passed: check.passed, detail: check.detail });
  }

  return { results, unanswered };
}
