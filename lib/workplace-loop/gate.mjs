/**
 * lib/workplace-loop/gate.mjs — routes a proposal's external effects through
 * the real governed-write chokepoint. Spike D only simulated this; production
 * actually gates through it.
 *
 * Spike D's request-approval/approve/apply subcommands wrote their own local
 * JSON files under runs/approvals/ and runs/external-effects/ — a hand-rolled
 * stand-in for approval + execution, proven only to itself. This module uses
 * the real lib/embed/approval-queue.mjs ApprovalQueue (the same durable queue
 * every other governed-write producer in this codebase enqueues onto) and the
 * real lib/writes/control-plane.mjs (drainApprovedWriteIntents /
 * executeApprovedWriteIntent — the sole formalized chokepoint)
 * to execute. There is no second approval or execution mechanism
 * here — every function below is a thin, proposal-shaped wrapper over those
 * two real modules, never a parallel implementation of what they already do.
 */

import { ApprovalQueue } from '../embed/approval-queue.mjs';
import { drainApprovedWriteIntents } from '../writes/control-plane.mjs';
import { writeIntentToolName } from '../writes/write-intent.mjs';

/**
 * Enqueue every proposed external effect onto the real ApprovalQueue,
 * awaiting_approval. lib/embed/approval-queue.mjs's `enqueue()` normalizes
 * `requestedBy` to a fixed {userId, serviceId, tenantId, sessionId, role}
 * shape and drops any other field, so the proposal↔approvalId linkage this
 * module needs for recovery across process restarts cannot live on the
 * queue record itself — the caller (lib/workplace-loop/cli.mjs) persists the
 * returned approvalIds back onto the proposal record via
 * lib/workplace-loop/state-store.mjs's saveProposalApprovals instead of this
 * module inventing a second queue-record schema.
 *
 * @param {object} proposal - propose.mjs's buildProposal() output
 * @param {ApprovalQueue} queue
 * @param {object} [opts]
 * @param {object} [opts.requestedBy]
 * @returns {Array<object>} the enqueued ApprovalQueue records, one per effect, in
 *   proposal.proposedExternalEffects order
 */
export function requestApproval(proposal, queue, { requestedBy = { serviceId: 'workplace-loop' } } = {}) {
  return proposal.proposedExternalEffects.map((effect) => queue.enqueue({
    tool: writeIntentToolName(effect.providerId, effect.writeKind),
    args: effect.payload,
    surface: 'workplace-loop',
    requestedBy,
  }));
}

/**
 * Resolve a set of approvalIds (persisted on a proposal record by
 * saveProposalApprovals) into their current ApprovalQueue records. Missing
 * ids (a record purged or never enqueued) are silently dropped rather than
 * throwing — a caller checking "are all effects approved" already treats an
 * absent record as unapproved.
 *
 * @param {string[]} approvalIds
 * @param {ApprovalQueue} queue
 * @returns {Array<object>}
 */
export function recordsForApprovalIds(approvalIds, queue) {
  return (approvalIds ?? []).map((id) => queue.getById(id)).filter(Boolean);
}

/**
 * Approve every awaiting_approval record this proposal enqueued. Mirrors
 * spike D's `approve` subcommand's authority requirement (a named approver)
 * but resolves real ApprovalQueue records instead of writing a local file.
 *
 * @param {Array<object>} records - requestApproval()'s return value
 * @param {ApprovalQueue} queue
 * @param {object} decidedBy - actor identity of the approver; required, no default identity is fabricated
 * @returns {Array<object>} the approved records
 */
export function approveAll(records, queue, decidedBy) {
  if (!decidedBy || (!decidedBy.userId && !decidedBy.serviceId)) {
    throw new Error('workplace-loop gate.approveAll: decidedBy must name a real approver (userId or serviceId) — no default approver is fabricated');
  }
  return records.map((record) => queue.approve(record.approvalId, { decidedBy, reason: 'workplace-loop proposal approved' }));
}

/**
 * Drain every approved record through the real control-plane chokepoint.
 * Refuses (throws) if any of the proposal's records are not yet approved —
 * the same "REFUSED: no approval record" discipline spike D's `apply`
 * subcommand proved (§2.9), now enforced by the real queue's own state
 * machine rather than a hand-checked file-existence test.
 *
 * @param {Array<object>} records - requestApproval()'s return value
 * @param {ApprovalQueue} queue
 * @param {object} [opts] - forwarded to drainApprovedWriteIntents (adapterFactories, sentLog, rootDir)
 * @returns {Promise<Array<object>>} control-plane's per-record outcomes
 */
export async function applyProposal(records, queue, opts = {}) {
  const unapproved = records.filter((r) => queue.getById(r.approvalId)?.state !== 'approved');
  if (unapproved.length > 0) {
    throw new Error(
      `REFUSED: ${unapproved.length} of ${records.length} effect(s) have no approval record — `
      + 'the workplace loop will not apply a partially- or un-approved proposal.',
    );
  }
  const executedApprovalIds = new Set();
  return drainApprovedWriteIntents(queue, { ...opts, executedApprovalIds });
}
