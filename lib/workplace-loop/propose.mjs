/**
 * lib/workplace-loop/propose.mjs — builds a Proposal artifact from aligned
 * signals (construct-b0nny.25), generalizing spike D's proposal shape
 * (docs/notes/research/workspace-control-plane/spikes/d-daily-workplace-loop/
 * loop/run-loop.mjs's `proposal` object in detect()) into real writeIntent-
 * shaped effects (lib/writes/write-intent.mjs) instead of spike D's ad hoc
 * `{target, id, action, changes, comment}` shape — so gate.mjs can hand
 * `proposed_external_effects` straight to `ApprovalQueue.enqueue()` /
 * `buildWriteIntent()` with no adaptation layer between "what was proposed"
 * and "what actually executes" (the exact seam spike D never had to prove
 * since its effects were only ever simulated).
 *
 * Only signals whose alignment verdict is `conflict`, or whose type is
 * itself unconditionally actionable (`unowned_risk_issue` — an unowned,
 * risk-labeled issue warrants a flag-for-triage comment regardless of
 * strategy alignment, matching spike D's own unowned-blocker handling),
 * produce a proposed effect. Every other signal (aligned, or no_strategy_configured)
 * is reported but generates no external effect — the same "meaningful,
 * healthy, no action" bucket spike D's report distinguished (§2.5).
 */

import crypto from 'node:crypto';

function issueNumberFromRef(ref) {
  const match = /^#(\d+)$/.exec(ref ?? '');
  return match ? Number(match[1]) : null;
}

function isActionable(signal) {
  return signal.alignment?.verdict === 'conflict' || signal.type === 'unowned_risk_issue';
}

function buildCommentBody(signal) {
  const lines = [
    `Flagged by the workplace loop: ${signal.summary}`,
    signal.alignment?.verdict === 'conflict'
      ? `Strategy alignment: conflict with pillar "${signal.alignment.pillar}" — ${signal.alignment.rationale}`
      : `Alignment: ${signal.alignment?.verdict ?? 'not checked'}.`,
    '',
    `Signal id: ${signal.id} (${signal.type}, severity ${signal.severity}).`,
  ];
  return lines.join('\n');
}

/**
 * @param {object} opts
 * @param {Array<object>} opts.signals - alignment-annotated signals (align.mjs's alignSignals output)
 * @param {number} opts.runNumber
 * @param {string} [opts.asOf]
 * @returns {object|null} a proposal record, or null when no signal is actionable (spike D's
 *   "nothing to propose" path — no-fabrication: an empty actionable set produces no proposal file)
 */
export function buildProposal({ signals, runNumber, asOf = new Date().toISOString() }) {
  const actionable = signals.filter(isActionable);
  if (actionable.length === 0) return null;

  const proposalId = `PROP-${runNumber}`;
  const cites = actionable.flatMap((s) => (s.sources ?? []).map((src) => `${src.kind}:${src.repo}${src.ref}`));

  const proposedExternalEffects = actionable
    .map((signal) => {
      const source = signal.sources?.[0];
      const issueNumber = issueNumberFromRef(source?.ref);
      if (source?.kind !== 'github' || issueNumber == null) return null;
      return {
        providerId: 'github',
        writeKind: 'comment',
        payload: { issue_number: issueNumber, body: buildCommentBody(signal) },
        rationale: signal.summary,
        signalId: signal.id,
      };
    })
    .filter(Boolean);

  return {
    proposalId,
    status: 'pending_approval',
    createdAt: asOf,
    basedOnSignals: actionable.map((s) => s.id),
    brief: {
      title: `Workplace loop findings — run #${runNumber}`,
      body: actionable.map((s) => `- ${s.summary}`).join('\n'),
      cites: [...new Set(cites)],
    },
    proposedExternalEffects,
    contentHash: crypto.createHash('sha256')
      .update(JSON.stringify({ basedOnSignals: actionable.map((s) => s.id), proposedExternalEffects }))
      .digest('hex'),
  };
}
