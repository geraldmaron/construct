/**
 * kernel/lessons/fromDecisions.ts — a resolved cross-domain decision,
 * transcribed into a candidate lesson.
 *
 * Every other lesson in this system starts from a document a person handed
 * Construct. This is the first that starts from Construct's own operation: a
 * decision raised because two roles could not both be right (commitment 11),
 * with both sides cited, resolved by a human. That resolution is exactly the
 * kind of standing knowledge a workspace should carry forward — the same
 * disagreement should not have to be re-decided from nothing next time it
 * comes up — and today nothing carries it anywhere once `construct decide`
 * writes the row.
 *
 * The distillation is mechanical, deliberately: no model reads the decision
 * and no model is asked whether it is a real lesson. The body is assembled
 * verbatim from typed store columns — the question, each position's role and
 * stance, the resolution text — so there is nothing here for a model to
 * misread or invent. That is also why it is not the same risk as an
 * adversarial-passed lesson: nothing adversarial happened, because nothing
 * needed to. Whether it is nonetheless safe to admit without a human is the
 * admission gate's question, not this module's — see runDerived() in
 * lessons/admission.ts, which treats this citation scheme as its own
 * provenance rather than trusting it for being self-generated.
 */

import type { Decision } from '../store/decisions.ts';

export interface DecisionLesson {
  readonly id: string;
  readonly body: string;
  /** `decision:<id>` — resolved against the decisions table, never a note. */
  readonly citation: string;
  /** Every role named in the decision's positions, for the caller to tier by. */
  readonly domains: readonly string[];
}

/** The citation scheme this module writes and the gate recognizes. */
export const DECISION_CITATION_PREFIX = 'decision:';

/**
 * Distill one resolved decision into a lesson candidate. Null for anything
 * not yet resolved — an open decision has no resolution to learn from, and
 * distilling one anyway would record a lesson whose second half changes under
 * it, which the append-only lesson store cannot represent as an edit.
 */
export function distillDecisionLesson(decision: Decision): DecisionLesson | null {
  if (decision.state !== 'resolved' || decision.resolution === null) return null;

  // Construct's own reversible-default note rides in `positions` under the
  // role name "construct" (coordinator.ts, every raiseDecision call site) so
  // the reader sees it beside the roles it is weighing. It is framing, not a
  // role's finding, and folding it into "roles held" the same way a real
  // specialist's cited stance is folded in would overstate what a role
  // established — the exact misattribution the position pass exists to catch
  // elsewhere in this system. Excluded from both the transcribed stances and
  // the domains a human reviewer tiers this lesson by.
  const roles = decision.positions.filter((p) => p.role !== 'construct');

  const stances = roles.map((p) => `${p.role} held: "${p.stance}"`).join('; ');
  const body =
    `A cross-domain disagreement this workspace resolved before — "${decision.question}". ` +
    `${stances}. Resolved: "${decision.resolution}".`;

  return {
    id: `lesson-${decision.id}`,
    body,
    citation: `${DECISION_CITATION_PREFIX}${decision.id}`,
    domains: [...new Set(roles.map((p) => p.role))],
  };
}
