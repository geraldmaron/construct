/**
 * kernel/run/apply.ts — carrying out an outward write that a human approved.
 *
 * The proposal machinery could file a change, hold it for a decision, and
 * record that it was applied. Nothing performed the application. An approved
 * proposal against a tracker or a documents system therefore terminated as a
 * row: the user had said yes, the record said approved, and the ticket never
 * moved. Approved-and-never-applied and approved-and-applied were the same
 * state to anyone reading the queue, which is worse than not being able to
 * apply at all.
 *
 * Construct still builds no connectors, and this module opens none. It hands
 * the approved change to the host the run already dispatches through and asks
 * whether the host could carry it out. A host with a tracker connector can; a
 * host with none says so, and that answer is recorded as unappliable with its
 * reason instead of leaving the proposal sitting approved forever. What the
 * kernel owns is the discipline around that answer:
 *
 *   - Only an approved proposal is handed over. Applying without authority is
 *     already refused by the store; this refuses it a step earlier so nothing
 *     is attempted that could not be recorded.
 *   - A rejection is never overridden. A proposal a human said no to is not
 *     retried by a surface that can also apply.
 *   - The applied decision is written only from what the host reported
 *     succeeding. A host that says it failed, or that says nothing legible,
 *     leaves the proposal approved and unapplied — the honest state — because
 *     recording an apply the world did not receive is the one failure this
 *     module exists to prevent.
 */

import type { Store } from '../store/open.ts';
import { decisionOf, getProposal, markApplied } from '../store/sources.ts';
import type { WriteProposal } from '../store/sources.ts';

/**
 * What a host reported about carrying out one change. `applied` is a claim
 * about the world; `detail` is what the host said, and it is recorded whether
 * the answer was yes or no, because "why not" is the whole value of a no.
 */
export interface ApplyReport {
  readonly applied: boolean;
  readonly detail: string;
}

/**
 * A host asked to carry out one approved change. Throws only when the host
 * itself failed to answer; a host that answered "I cannot reach that system"
 * returns `applied: false`, which is a result rather than an error.
 */
export type ProposalApplier = (proposal: WriteProposal) => Promise<ApplyReport>;

export type ApplyOutcome =
  | { readonly outcome: 'applied'; readonly detail: string }
  | { readonly outcome: 'unappliable'; readonly reason: string }
  | { readonly outcome: 'refused'; readonly reason: string };

/**
 * Hand one approved proposal to a host and record what came back.
 *
 * Never throws on a proposal's own state: an unknown id, an undecided
 * proposal, a rejected one, and one already applied are all answers a caller
 * prints, not exceptions it handles.
 */
export async function applyProposal(
  store: Store,
  apply: ProposalApplier,
  proposal: string,
  at: string,
): Promise<ApplyOutcome> {
  const record = getProposal(store, proposal);
  if (!record) return { outcome: 'refused', reason: `no proposal ${proposal}` };

  const prior = decisionOf(store, proposal);
  if (!prior) {
    return {
      outcome: 'refused',
      reason: 'nobody has decided it yet — an undecided proposal is not one to carry out',
    };
  }
  if (prior.verdict === 'rejected') {
    return {
      outcome: 'refused',
      reason: `it was rejected (${prior.reason}); a rejection is not overridden by applying anyway`,
    };
  }
  if (prior.verdict === 'applied') {
    return { outcome: 'refused', reason: `it was already applied at ${prior.decidedAt}` };
  }

  let report: ApplyReport;
  try {
    report = await apply(record);
  } catch (error) {
    // The host failed to answer at all, which says nothing about whether the
    // change landed. Approved-and-unapplied is the only state that is honest
    // about an unknown, so nothing is recorded.
    return {
      outcome: 'unappliable',
      reason: `the host could not be asked (${(error as Error).message}); it stays approved and unapplied`,
    };
  }

  if (!report.applied) {
    return {
      outcome: 'unappliable',
      reason:
        `${report.detail.trim() || 'the host gave no reason'} — it stays approved and unapplied, ` +
        'so the change is still yours to make',
    };
  }

  markApplied(store, proposal, report.detail.trim() || 'the host reported it applied', at);
  return { outcome: 'applied', detail: report.detail.trim() };
}
