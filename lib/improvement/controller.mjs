/**
 * lib/improvement/controller.mjs — the approval-gated improvement-loop controller
 * (construct-6zga.1.5).
 *
 * The controller is the mutation boundary for the governed loop. It admits only
 * versioned artifacts — proposal objects, dataset items, and evaluation reports,
 * never raw unversioned session history — and refuses any candidate that lacks provenance,
 * lacks held-out evaluation evidence, failed a deterministic gate, names an unknown
 * approver, or has an unresolved dependency. Promotability is re-derived from the
 * report's own gate results rather than a precomputed flag, so a tampered decision
 * cannot pass. The final mutation boundary requires an explicit human approval act,
 * recorded with the approver identity and timestamp; the controller never applies a
 * change itself — it plans the rollout and records the human-performed apply and
 * rollback, keeping the loop a chain of proposals, not autonomous mutations.
 */
import { transitionProposal, validateProposal } from './proposal.mjs';
import { decidePromotion } from '../evals/gates.mjs';

function isVersioned(artifact) {
  return Boolean(artifact && typeof artifact === 'object' && Number.isInteger(artifact.schemaVersion));
}

/**
 * Admit the input artifacts. Only versioned proposal/dataset/evaluation objects are
 * accepted; an unversioned blob (such as raw session history) is refused
 * (construct-6zga.1.5 AC1).
 */
export function admitArtifacts({ proposal = null, dataset = null, evaluationReport = null } = {}) {
  const refusals = [];
  if (!validateProposal(proposal).valid) refusals.push('proposal-invalid');
  if (!isVersioned(dataset)) refusals.push('dataset-unversioned');
  if (!isVersioned(evaluationReport)) refusals.push('evaluation-report-unversioned');
  return { admissible: refusals.length === 0, refusals };
}

/**
 * Evaluate the refusal guards. Missing provenance, missing held-out results, a
 * failed deterministic gate, an unknown approver, or an unresolved dependency each
 * blocks the proposal from reaching the approval boundary (construct-6zga.1.5 AC2).
 */
export function evaluateGuards({ proposal = null, evaluationReport = null, knownApprovers = [], resolvedDependencies = [] } = {}) {
  const refusals = [];

  const traces = proposal?.lineage?.inputTraceIds;
  if (!Array.isArray(traces) || traces.length < 1) refusals.push('insufficient-provenance');

  if (!evaluationReport || evaluationReport.deltas == null) refusals.push('missing-held-out-results');
  if (evaluationReport?.blocked === true) refusals.push('failed-deterministic-checks');

  const approverId = proposal?.approver?.identity ?? null;
  if (!approverId || !knownApprovers.includes(approverId)) refusals.push('unknown-approver');

  const deps = Array.isArray(proposal?.dependencies) ? proposal.dependencies : [];
  const resolved = new Set(resolvedDependencies);
  if (deps.some((d) => !resolved.has(d))) refusals.push('unresolved-dependency');

  return { admissible: refusals.length === 0, refusals };
}

/**
 * Run the full admission + guard pipeline and re-derive promotability from the
 * report's gate results (judges never stand alone). Returns the stage that refused,
 * or admissible: true once the proposal is ready for the human approval boundary.
 */
export function governProposal({ proposal = null, dataset = null, evaluationReport = null, knownApprovers = [], resolvedDependencies = [] } = {}) {
  const admission = admitArtifacts({ proposal, dataset, evaluationReport });
  if (!admission.admissible) return { admissible: false, stage: 'admission', refusals: admission.refusals };

  const guards = evaluateGuards({ proposal, evaluationReport, knownApprovers, resolvedDependencies });
  if (!guards.admissible) return { admissible: false, stage: 'guards', refusals: guards.refusals };

  const gates = Array.isArray(evaluationReport.gates) ? evaluationReport.gates : [];
  const deterministic = {
    blocked: evaluationReport.blocked === true,
    regressions: gates.filter((g) => !g.pass).map((g) => g.gate),
    gates,
  };
  const promotion = decidePromotion({ deterministic, judges: evaluationReport.evaluators || [] });
  if (!promotion.promotable) return { admissible: false, stage: 'promotion', refusals: ['not-promotable'], promotion };

  return { admissible: true, stage: 'awaiting-approval', refusals: [], promotion };
}

/**
 * The final mutation boundary: an explicit human approval act is mandatory and is
 * recorded with the approver identity and timestamp. Transitions
 * awaiting_approval -> approved, or refuses (construct-6zga.1.5 AC3).
 */
export function requireApproval({ proposal = null, approval = null, knownApprovers = [], nowIso = null } = {}) {
  if (proposal?.state !== 'awaiting_approval') {
    return { ok: false, error: `approval requires state awaiting_approval, got ${proposal?.state}` };
  }
  const identity = approval?.identity ?? null;
  if (!identity || !knownApprovers.includes(identity)) {
    return { ok: false, error: 'approval refused: unknown approver' };
  }
  const approver = { identity, approvedAt: approval?.approvedAt ?? nowIso, decision: 'approved' };
  return transitionProposal(proposal, 'approved', { approver });
}

/**
 * Plan a traceable rollout for an approved proposal: sandbox, staged apply, and
 * post-apply monitoring, plus the rollback target and blast radius. The controller
 * plans but never applies — application is a human-performed action
 * (construct-6zga.1.5 AC4).
 */
export function planRollout({ proposal = null } = {}) {
  if (proposal?.state !== 'approved') return { ok: false, error: `rollout requires state approved, got ${proposal?.state}` };
  return {
    ok: true,
    plan: {
      mode: proposal.rolloutMode,
      steps: ['sandbox', 'staged-apply', 'post-apply-monitor'],
      rollbackTarget: proposal.rollbackTarget,
      affectedProfiles: proposal.affectedProfiles,
      blastRadius: proposal.blastRadius,
    },
  };
}

/**
 * Record a human-performed application (approved -> applied) with its monitor
 * handle, keeping the apply traceable (construct-6zga.1.5 AC4).
 */
export function recordApplication({ proposal = null, monitor = null, nowIso = null } = {}) {
  return transitionProposal(proposal, 'applied', { rollout: { appliedAt: nowIso, monitor } });
}

/**
 * Record a deterministic rollback (applied -> rolled_back) to the proposal's
 * declared rollback target (construct-6zga.1.5 AC4).
 */
export function recordRollback({ proposal = null, reason = null, nowIso = null } = {}) {
  return transitionProposal(proposal, 'rolled_back', {
    rollout: { rolledBackTo: proposal?.rollbackTarget ?? null, reason, rolledBackAt: nowIso },
  });
}
