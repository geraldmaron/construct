/**
 * kernel/run/accountability.ts — the two things the work log has to carry
 * beyond "a role ran": what was flagged, and what needs a licensed human.
 *
 * Commitment 4 says invocation is invisible but accountability never is, and
 * commitment 15 says nothing is asserted that cannot be supported. Those two
 * together decide the shape of this module: every flag below is read off what
 * the host itself reported, never inferred from the wording of a deliverable.
 * "The role sounded uncertain" is not a fact this system has; "the role's file
 * read failed and it answered anyway" is.
 *
 * Licensed review works the other way round — it is a property of the domain,
 * declared in the catalog, not a judgment about a particular deliverable. A
 * privacy issue-spot needs an attorney's eyes whether or not the issue-spot
 * itself sounds alarming, and deciding case by case would make the safeguard
 * depend on the very output it is meant to qualify (STRATEGY risk 3).
 */

import { DOMAINS, domainsByName } from '../implication/domains.ts';
import type { Domain } from '../implication/domains.ts';
import { readWorkLog } from '../store/worklog.ts';
import type { Store } from '../store/open.ts';


export const CONCERN_KINDS = ['incomplete-inputs', 'empty-deliverable', 'truncated', 'model-drift'] as const;

export type ConcernKind = (typeof CONCERN_KINDS)[number];

export interface Concern {
  readonly kind: ConcernKind;
  /** Why, in the user's words. */
  readonly detail: string;
  /** The host-reported fact behind it. Never a paraphrase of the deliverable. */
  readonly evidence: unknown;
}

interface Reported {
  readonly text?: unknown;
  readonly failedToolCalls?: unknown;
  readonly finishReasons?: unknown;
  readonly modelRequested?: unknown;
  readonly modelRan?: unknown;
}

/**
 * What is wrong with a deliverable, judged only from what the host reported
 * about producing it.
 *
 * Takes the deliverable rather than the whole host result so the same function
 * answers for a stored one — a task read back out of the store must produce the
 * same flags it produced when it settled, and two code paths for that would
 * eventually disagree.
 *
 * Deliberately three narrow checks rather than a general quality read. A role
 * that could not open the document it was asked about, one that returned
 * nothing, and one that was cut off mid-answer are all cases where the
 * deliverable is standing on less than it appears to be — and all three are
 * facts the host states outright.
 */
export function deliverableConcerns(deliverable: unknown): Concern[] {
  const output = deliverable as Reported | null;
  const concerns: Concern[] = [];

  const failed = Array.isArray(output?.failedToolCalls) ? output.failedToolCalls : [];
  if (failed.length > 0) {
    concerns.push({
      kind: 'incomplete-inputs',
      detail: `answered despite ${String(failed.length)} failed tool call(s) — it could not read everything it reached for`,
      evidence: failed,
    });
  }

  const text = typeof output?.text === 'string' ? output.text : '';
  if (text.trim() === '') {
    concerns.push({
      kind: 'empty-deliverable',
      detail: 'the run succeeded but produced no text',
      evidence: { chars: text.length },
    });
  }

  // 'length' is the finish reason for hitting the output limit. Other reasons
  // are left alone: an unfamiliar one is not evidence of anything, and guessing
  // at its meaning is the invention half of commitment 15.
  const reasons = Array.isArray(output?.finishReasons) ? output.finishReasons : [];
  if (reasons.includes('length')) {
    concerns.push({
      kind: 'truncated',
      detail: 'the answer was cut off at the output limit, so it is not the whole answer',
      evidence: { finishReasons: reasons },
    });
  }

  // A host that treats the model flag as a preference can silently serve a run
  // on a different — possibly far more expensive — model (measured on the
  // pinned Claude CLI: an unknown name ran the opus default at 13x the price).
  // Adapters that can tell say so via modelRequested/modelRan; inclusion
  // rather than equality because hosts accept aliases ("haiku" is honored by
  // "claude-haiku-4-5-..."). Hosts that do not report these fields are left
  // alone — absence of the fields is not evidence of drift.
  const requested = output?.modelRequested;
  const ran = Array.isArray(output?.modelRan) ? (output.modelRan as unknown[]) : [];
  if (typeof requested === 'string' && requested && ran.length > 0) {
    const honored = ran.some(
      (model) =>
        typeof model === 'string' && (model.includes(requested) || requested.includes(model)),
    );
    if (!honored) {
      concerns.push({
        kind: 'model-drift',
        detail: `you asked for model "${requested}" but the host ran ${ran.map(String).join(', ')} — check the spend line`,
        evidence: { modelRequested: requested, modelRan: ran },
      });
    }
  }

  return concerns;
}

/**
 * A stated limit on what produced a deliverable, recovered from the run's own
 * record so it can be printed next to the text it qualifies.
 *
 * The defect this closes: the dispatch already records that a model family is
 * unvalidated, or that the run fell below the capability floor its brief
 * declared, and both facts lived only in the work log. A deliverable read on
 * its own — which is how a deliverable is read — carried no trace of either,
 * and a lens-less role had nothing else to carry one. So the qualification was
 * true, recorded, and invisible to exactly the reader it exists for.
 *
 * Read off the log rather than re-derived from the host, for the reason
 * `deliverableConcerns` takes a stored deliverable: a task read back must
 * qualify the same way it qualified when it settled, and two code paths for
 * that eventually disagree.
 */
export interface DeliverableLimit {
  /** One line, in the reader's words, stating what the text cannot claim. */
  readonly label: string;
  /** The recorded detail behind it, never a paraphrase. */
  readonly evidence: unknown;
}

export function limitsFor(store: Store, run: string, task: string): DeliverableLimit[] {
  const limits: DeliverableLimit[] = [];
  for (const entry of readWorkLog(store, run)) {
    if (entry.task !== task) continue;
    const detail = entry.detail as Record<string, unknown> | null;
    if (entry.action === 'model-untuned-best-effort') {
      const family = typeof detail?.family === 'string' ? detail.family : null;
      const model = typeof detail?.model === 'string' ? detail.model : null;
      limits.push({
        label:
          'best-effort: this was produced by ' +
          (family ? `the ${family} family` : model ? model : 'a model family') +
          ', whose output shape and citation habits are unvalidated here — ' +
          'nothing that quotes this may drop that qualification',
        evidence: detail,
      });
    }
    if (entry.action === 'model-floor-degraded') {
      const why = typeof detail?.why === 'string' ? detail.why : 'the declared floor was not met';
      limits.push({ label: `below the declared capability floor: ${why}`, evidence: detail });
    }
  }
  return limits;
}

/**
 * The profession that must review this role's output before anyone relies on
 * it, or null when the domain does not call for one. Declared in the catalog —
 * see the module note on why this is not a per-deliverable judgment.
 */
export function licensedReviewFor(
  role: string,
  catalog: readonly Domain[] = DOMAINS,
): string | null {
  return domainsByName(catalog).get(role)?.licensedReview ?? null;
}
