/**
 * Runs the opt-in, attribution-first Worker Profile improvement loop.
 *
 * External failure causes take precedence over Worker Profile attribution.
 * Eligible failures produce one governed proposal and never apply changes.
 */

import { governProposal } from './controller.mjs';

const TRIGGER_KINDS = new Set([
  'human-correction',
  'deterministic-failure',
  'repeated-baseline-regression',
  'operator-request',
]);

const TARGETS = new Set(['prompt', 'skill', 'role-flavor', 'routing-rule', 'contract']);

const HUMAN_TARGET_TO_CAUSE = Object.freeze({
  upstream: 'upstream-context',
  contract: 'handoff-contract',
  downstream: 'downstream-consumer',
  provider: 'provider-execution',
  workerProfile: 'worker-profile-prompt',
});

function attributeFailure(trace = {}) {
  const correctionTarget = trace.humanCorrection?.target ?? null;
  if (correctionTarget && correctionTarget !== 'workerProfile') {
    return {
      cause: HUMAN_TARGET_TO_CAUSE[correctionTarget] || 'upstream-context',
      blameWorkerProfile: false,
      detail: `human correction -> ${correctionTarget}`,
    };
  }
  if (trace.upstream?.evidenceComplete === false || trace.upstream?.inputsPresent === false) {
    return { cause: 'upstream-context', blameWorkerProfile: false, detail: 'upstream evidence or inputs incomplete' };
  }
  if (trace.provider?.executionError === true || trace.provider?.degraded === true) {
    return { cause: 'provider-execution', blameWorkerProfile: false, detail: 'provider execution error or degraded' };
  }
  if (trace.handoff?.inputValid === false) {
    return { cause: 'handoff-contract', blameWorkerProfile: false, detail: 'handoff input contract violated' };
  }
  if (trace.downstream?.consumerError === true) {
    return { cause: 'downstream-consumer', blameWorkerProfile: false, detail: 'downstream consumer error' };
  }
  if (trace.evaluator?.abstained === true) {
    return { cause: 'evaluator-uncertainty', blameWorkerProfile: false, detail: 'evaluator abstained' };
  }

  const workerProfileFault = trace.workerProfileOutput?.evidenceVerdict === 'fail'
    || trace.handoff?.schemaValid === false
    || correctionTarget === 'workerProfile';
  if (workerProfileFault) {
    return {
      cause: 'worker-profile-prompt',
      blameWorkerProfile: true,
      detail: 'Worker Profile output failed with every external cause clean',
    };
  }
  return { cause: 'none', blameWorkerProfile: false, detail: 'no attributable failure' };
}

function proposeWorkerProfileChange({
  trace,
  target,
  baselineVersion,
  candidateVersion,
  heldOutProfiles,
  approver,
}) {
  const profiles = heldOutProfiles.length
    ? heldOutProfiles
    : [trace.workerProfile?.profileId || trace.workerProfile?.id].filter(Boolean);
  const traceIds = trace.sourceTraceIds?.length ? trace.sourceTraceIds : [trace.id].filter(Boolean);
  return {
    schemaVersion: 1,
    id: `prop-${trace.id || 'worker-profile'}`,
    type: TARGETS.has(target) ? target : 'prompt',
    state: 'proposal_ready',
    affectedProfiles: profiles,
    blastRadius: 'single-surface',
    rollbackTarget: { version: baselineVersion || trace.versions?.[target] || 'unknown', ref: null },
    requiredGates: ['contract-schema', 'source-provenance', 'safety-permission'],
    rolloutMode: 'staged',
    dependencies: [],
    evaluationReportId: null,
    terminalReason: null,
    lineage: {
      inputTraceIds: traceIds,
      baselineVersion: baselineVersion || 'unknown',
      candidateVersion: candidateVersion || 'unknown',
      capabilitySnapshot: { capabilityClass: trace.workerProfile?.capabilityClass || 'unknown' },
      evaluatorVersions: ['gates@1'],
      budgets: null,
    },
    approver: approver ? { identity: approver, approvedAt: null, decision: null } : null,
    rollout: null,
  };
}

export function runWorkerProfileImprovement({
  trace = {},
  trigger = null,
  target = 'prompt',
  heldOutProfiles = [],
  baselineVersion = null,
  candidateVersion = null,
  approver = null,
  dataset = null,
  evaluationReport = null,
  knownApprovers = [],
  resolvedDependencies = [],
} = {}) {
  if (trigger?.optIn !== true || !TRIGGER_KINDS.has(trigger?.kind)) {
    return { triggered: false, reason: 'not-triggered' };
  }

  const attribution = attributeFailure(trace);
  if (!attribution.blameWorkerProfile) {
    return { triggered: true, attribution, proposed: false, reason: attribution.cause };
  }

  const proposal = proposeWorkerProfileChange({
    trace,
    target,
    baselineVersion,
    candidateVersion,
    heldOutProfiles,
    approver,
  });
  const governance = governProposal({
    proposal,
    dataset,
    evaluationReport,
    knownApprovers,
    resolvedDependencies,
  });
  return { triggered: true, attribution, proposed: true, proposal, governance };
}
