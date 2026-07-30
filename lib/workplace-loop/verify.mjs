/**
 * lib/workplace-loop/verify.mjs — post-execution verification,
 * generalizing spike D's verify subcommand (docs/notes/research/
 * workspace-control-plane/spikes/d-daily-workplace-loop/loop/run-loop.mjs's
 * verify(), which hashed a locally-simulated "sent" file against the
 * proposal). Production has no simulated sent file — the real ApprovalQueue
 * record IS the sent record (`executedAt`/`executionResult` stamped by
 * lib/writes/control-plane.mjs's drainApprovedWriteIntents), so this module
 * reads that real state instead of re-deriving a parallel one.
 */

import crypto from 'node:crypto';

function recomputeContentHash(proposal) {
  return crypto.createHash('sha256')
    .update(JSON.stringify({ basedOnSignals: proposal.basedOnSignals, proposedExternalEffects: proposal.proposedExternalEffects }))
    .digest('hex');
}

/**
 * @param {object} proposal - propose.mjs's buildProposal() output
 * @param {Array<object>} records - gate.requestApproval()'s return value
 * @param {import('../embed/approval-queue.mjs').ApprovalQueue} queue
 * @returns {{proposalId: string, result: 'MATCH'|'DRIFTED'|'INCOMPLETE', contentHashMatch: boolean, effects: Array<object>}}
 */
export function verifyProposalExecution(proposal, records, queue) {
  const contentHashMatch = recomputeContentHash(proposal) === proposal.contentHash;

  const effects = records.map((record) => {
    const current = queue.getById(record.approvalId);
    return {
      approvalId: record.approvalId,
      tool: current?.toolCall?.tool ?? null,
      state: current?.state ?? 'unknown',
      executed: !!current?.executedAt,
      executionError: current?.executionError ?? null,
    };
  });

  const allExecuted = effects.length > 0 && effects.every((e) => e.executed && !e.executionError);

  return {
    proposalId: proposal.proposalId,
    result: !contentHashMatch ? 'DRIFTED' : (allExecuted ? 'MATCH' : 'INCOMPLETE'),
    contentHashMatch,
    effects,
  };
}
