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
 *   - Only a change with authority behind it is handed over, and there are two
 *     kinds: a human approval on this proposal, or the workspace's standing
 *     consent, which covers the low-risk class and nothing else. High risk is
 *     outside standing consent in every workspace — it waits for a person.
 *     The store refuses to record an apply without one of those two; this
 *     refuses it a step earlier so nothing is attempted that could not be
 *     recorded.
 *   - A rejection is never overridden. A proposal a human said no to is not
 *     retried by a surface that can also apply.
 *   - The applied decision is written only from what the host reported
 *     succeeding. A host that says it failed, or that says nothing legible,
 *     leaves the proposal approved and unapplied — the honest state — because
 *     recording an apply the world did not receive is the one failure this
 *     module exists to prevent.
 *   - In seat mode, a change bound for the team's tracker is mirrored before
 *     it crosses: a projection row carrying only the fields the domain may
 *     assert, written before the host is asked, so a write landing in someone
 *     else's tracker can never outrun its record here. The store enforces the
 *     "only what the domain may assert" half, so a second attempt against a
 *     mirror an import already filled cannot take a tracker-owned field over.
 *     The row moves to in-sync only on a host's report that the change landed,
 *     which is the same evidence the applied decision is written from. Team
 *     mode and a workspace with no tracker source record nothing and behave as
 *     before.
 */

import type { Store } from '../store/open.ts';
import {
  decisionOf,
  engagementMode,
  getProposal,
  getSource,
  HUMAN_DECISION,
  markApplied,
  sourceDeclaration,
  writeConsentAllowsLowRisk,
} from '../store/sources.ts';
import type { WriteProposal } from '../store/sources.ts';
import { markProjectionSynced, projectDomainFields } from '../store/projections.ts';
import { buildProjection, projectionId } from '../tracker/projection.ts';
import { isTrackerSourceKind, proposalIssue } from '../tracker/crossing.ts';

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
  | { readonly outcome: 'applied'; readonly detail: string; readonly projected?: string }
  | { readonly outcome: 'unappliable'; readonly reason: string; readonly projected?: string }
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
  // An approval is the human authority this ladder waits for only when its
  // provenance says a person recorded it. A model that wrote a byte-identical
  // `approved` row through an MCP surface has forged exactly that, so such an
  // approval is refused before a host is asked — the store's markApplied holds
  // the same line, this one gives the reason a person reads.
  if (prior?.verdict === 'approved' && prior.resolvedBy !== HUMAN_DECISION) {
    return {
      outcome: 'refused',
      reason: `its approval was recorded by ${prior.resolvedBy ?? 'an unrecorded hand'}, not a person — an outward write is carried out only on a human decision`,
    };
  }
  // The two authorities the store accepts when it writes the applied row,
  // asked here so nothing is handed to a host that could not be recorded
  // afterwards. Standing consent is a workspace's blanket yes to the low-risk
  // class, and three things sit outside it, each waiting for a person: a
  // high-risk change; a source its owner declared sensitive — and, because that
  // is a stated fact, a source with no declaration at all, whose safety is
  // unknown rather than assumed; and a change whose action a model chose, which
  // must not ride the yes a keyword default or an operator override earns.
  // Every refusal here fires before the host is asked, because a gate that
  // throws after the write leaves the world changed and the ledger ignorant.
  const declaration = sourceDeclaration(store, record.source);
  const knownNotSensitive = declaration?.sensitive === false;
  const modelChosen = record.actionSource === 'model';
  const consented = writeConsentAllowsLowRisk(store, record.workspace);
  const standing = record.risk === 'low' && knownNotSensitive && !modelChosen && consented;
  if (!prior && !standing) {
    // A workspace that never gave standing consent is simply undecided; the
    // narrower reasons — a missing declaration, a model-chosen action — matter
    // only where consent is present and is the thing not reaching this change.
    return {
      outcome: 'refused',
      reason:
        record.risk === 'high'
          ? 'nobody has approved it, and a high-risk change is never carried out on standing consent'
          : declaration?.sensitive === true
            ? 'its source is declared sensitive, which standing consent does not cover — it waits for a human decision'
            : consented && declaration === null
              ? 'its source has no declaration, so standing consent cannot know it is safe — it waits for a human decision'
              : consented && modelChosen
                ? 'its action was chosen by a model, which standing consent does not cover — it waits for a human decision'
                : 'nobody has decided it yet — an undecided proposal is not one to carry out',
    };
  }
  if (prior?.verdict === 'rejected') {
    return {
      outcome: 'refused',
      reason: `it was rejected (${prior.reason}); a rejection is not overridden by applying anyway`,
    };
  }
  if (prior?.verdict === 'applied') {
    return { outcome: 'refused', reason: `it was already applied at ${prior.decidedAt}` };
  }

  // In seat mode, a change bound for the team's tracker is mirrored before it
  // is handed over: the projection row — carrying only what the domain side
  // may assert under the authority map — is the record that this crossing was
  // attempted, written first so neither a crash nor a host that answers
  // illegibly can leave a write in someone else's tracker with no record on
  // this side. The row is keyed by the proposal, so a retry updates the same
  // mirror rather than minting a second. Team mode, a non-tracker source, and
  // a source nobody declared record nothing and behave exactly as before.
  const source = getSource(store, record.source);
  const tracker =
    source !== null &&
    isTrackerSourceKind(source.kind) &&
    engagementMode(store, record.workspace) === 'seat'
      ? source.kind
      : null;
  const mirror = tracker === null ? null : projectionId(record.id, tracker);
  if (tracker !== null) {
    projectDomainFields(
      store,
      buildProjection(proposalIssue(record), {
        tracker,
        workspace: record.workspace,
        workId: record.run,
        importedAt: at,
      }),
    );
  }
  const projected = mirror !== null ? { projected: mirror } : {};

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
      ...projected,
    };
  }

  if (!report.applied) {
    return {
      outcome: 'unappliable',
      reason:
        `${report.detail.trim() || 'the host gave no reason'} — it stays approved and unapplied, ` +
        'so the change is still yours to make',
      ...projected,
    };
  }

  markApplied(store, proposal, report.detail.trim() || 'the host reported it applied', at);
  // Only now: the mirror said what was proposed, and the host has said it
  // landed. Marking the row in-sync any earlier would be the same lie the
  // applied decision is guarded against, told in a second place.
  if (mirror !== null) markProjectionSynced(store, mirror, at);
  return { outcome: 'applied', detail: report.detail.trim(), ...projected };
}
