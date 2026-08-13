/**
 * kernel/lessons/admission.ts — the gate between a distilled lesson and a
 * prompt.
 *
 * Serves commitment 5 (admission is risk-weighted: low-risk domains auto-admit
 * after an adversarial verification pass, high-risk domains require explicit
 * human approval) and the commitment 6 rule that overrides risk entirely: a
 * lesson whose source was an ingested external document can never auto-admit,
 * because verification by another LLM reading the same attacker-authored text
 * cannot be trusted to catch injected instructions. That rule is not a score
 * input — it runs first and cannot be outvoted.
 *
 * A lesson distilled from this run's own resolved decisions (see
 * lessons/fromDecisions.ts) is a third provenance and gets the same
 * unconditional human-approval treatment, for a different reason. It carries
 * none of the injection risk external text does — it is assembled verbatim
 * from typed store columns, not read by a model — but familiarity is not
 * verification either, and a system whose own output could admit itself into
 * its own future prompts without a human ever seeing it is certifying its own
 * work exactly as much as the caller-declared risk tier this module already
 * refuses to trust. Recognized structurally, from the citation the lesson was
 * recorded with, for the same reason the risk tier is derived rather than
 * declared: a caller that could mark its own lesson not-run-derived would be
 * the gate believing whatever it is told.
 *
 * The risk tier is derived from the domain catalog rather than declared by the
 * caller: a domain whose output requires licensed review before anyone relies
 * on it is high-risk, and a domain the catalog does not know is high-risk too,
 * because "unrated" and "safe" are different facts. A caller that could
 * declare its own lesson low-risk would be the gate certifying its own work.
 *
 * Every decision is recorded with its reason, append-only. Rollback of an
 * admitted lesson is a newer `held` row, never an edit — the same reasoning
 * that makes the work log a trigger, not a convention.
 */

import type { Store } from '../store/open.ts';
import { getLesson, lessonsFor, type Lesson } from '../store/lessons.ts';
import { DOMAINS } from '../implication/domains.ts';
import { DECISION_CITATION_PREFIX } from './fromDecisions.ts';

export type RiskTier = 'low' | 'high';

/**
 * A domain requiring licensed review is high-risk; so is a domain the catalog
 * has never heard of.
 */
export function riskTierFor(domain: string): RiskTier {
  const found = DOMAINS.find((d) => d.domain === domain);
  if (!found) return 'high';
  return found.licensedReview ? 'high' : 'low';
}

/** Whether a lesson's citation marks it as distilled from this run's own decisions. */
export function runDerived(lesson: Lesson): boolean {
  return lesson.citation.startsWith(DECISION_CITATION_PREFIX);
}

/** What the decision rests on. Human approval names its human. */
export type AdmissionBasis =
  | { readonly kind: 'adversarial-pass'; readonly detail: string }
  | { readonly kind: 'human-approval'; readonly approver: string; readonly detail: string };

export interface AdmissionDecision {
  readonly lesson: string;
  readonly verdict: 'admitted' | 'held';
  readonly basis: AdmissionBasis['kind'];
  readonly reviewer: string | null;
  readonly reason: string;
  readonly decidedAt: string;
}

export interface DecideAdmission {
  readonly lessonId: string;
  /** The domain the lesson teaches about; tiers are derived, not declared. */
  readonly domain: string;
  readonly basis: AdmissionBasis;
  /** Injected; the kernel never reads the clock. */
  readonly decidedAt: string;
}

interface Row {
  readonly lesson: string;
  readonly verdict: string;
  readonly basis: string;
  readonly reviewer: string | null;
  readonly reason: string;
  readonly decided_at: string;
}

function toDecision(row: Row): AdmissionDecision {
  return {
    lesson: row.lesson,
    verdict: row.verdict as AdmissionDecision['verdict'],
    basis: row.basis as AdmissionBasis['kind'],
    reviewer: row.reviewer,
    reason: row.reason,
    decidedAt: row.decided_at,
  };
}

function record(store: Store, decision: AdmissionDecision): AdmissionDecision {
  store.db
    .prepare(
      `INSERT INTO lesson_admissions (lesson, verdict, basis, reviewer, reason, decided_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      decision.lesson,
      decision.verdict,
      decision.basis,
      decision.reviewer,
      decision.reason,
      decision.decidedAt,
    );
  return decision;
}

/**
 * Run the gate and record the outcome. Holding is not an error — it is the
 * gate doing its job — so both verdicts return; only a lesson that does not
 * exist throws.
 *
 * Gate order is the design: external source is checked before the risk tier
 * so no tier, however low, can route an externally-sourced lesson around
 * human review.
 */
export function decideAdmission(store: Store, input: DecideAdmission): AdmissionDecision {
  const lesson = getLesson(store, input.lessonId);
  if (!lesson) throw new Error(`decideAdmission: no lesson ${input.lessonId}`);

  const human = input.basis.kind === 'human-approval';
  const reviewer = input.basis.kind === 'human-approval' ? input.basis.approver : null;
  const base = {
    lesson: lesson.id,
    basis: input.basis.kind,
    reviewer,
    decidedAt: input.decidedAt,
  } as const;

  if (lesson.external && !human) {
    return record(store, {
      ...base,
      verdict: 'held',
      reason:
        'source was an ingested external document: another model reading the same text cannot be trusted to catch injected instructions, so only a human admits it',
    });
  }

  if (runDerived(lesson) && !human) {
    return record(store, {
      ...base,
      verdict: 'held',
      reason:
        'source is this run\'s own resolved decision, not something Construct was told: nothing here needed an adversarial pass to catch, but familiarity with its own operation is not verification, so it needs the same human review an ingested document does',
    });
  }

  const tier = riskTierFor(input.domain);
  if (tier === 'high' && !human) {
    return record(store, {
      ...base,
      verdict: 'held',
      reason: `domain "${input.domain}" is high-risk: admission requires explicit human approval`,
    });
  }

  if (human) {
    return record(store, {
      ...base,
      verdict: 'admitted',
      reason: `human approval by ${reviewer}: ${input.basis.detail}`,
    });
  }

  return record(store, {
    ...base,
    verdict: 'admitted',
    reason: `low-risk domain "${input.domain}" with a recorded adversarial pass: ${input.basis.detail}`,
  });
}

/**
 * The standing verdict on a lesson: its newest decision. Append-only history
 * means revocation is a newer `held` row, and this read is where that newer
 * row wins.
 */
export function admissionOf(store: Store, lessonId: string): AdmissionDecision | null {
  const row = store.db
    .prepare('SELECT * FROM lesson_admissions WHERE lesson = ? ORDER BY seq DESC LIMIT 1')
    .get(lessonId) as Row | undefined;
  return row ? toDecision(row) : null;
}

/**
 * What a prompt assembler may actually use: the store's scoped read, narrowed
 * to lessons whose standing verdict is admitted. A lesson with no decision at
 * all is not operational — absence of a verdict is a hold nobody wrote down.
 */
export function operationalLessonsFor(store: Store, workspace: string): Lesson[] {
  return lessonsFor(store, workspace).filter(
    (lesson) => admissionOf(store, lesson.id)?.verdict === 'admitted',
  );
}
