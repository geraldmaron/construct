/**
 * lib/improvement/specialist-loop.mjs — opt-in, attribution-first specialist
 * improvement (construct-6zga.1.7).
 *
 * Specialist improvement is triggered, never ambient: no generic self-review loop
 * is inserted into every prompt, and an evaluation runs only from one of the
 * bounded triggers (human correction, deterministic failure, repeated baseline
 * regression, or an explicit operator request). Before any change is proposed, a
 * failure is attributed causally across upstream context, provider execution, the
 * handoff contract, the downstream consumer, evaluator uncertainty, and only last
 * the specialist's own output — so a specialist is never blamed for an upstream or
 * provider failure. A change is proposed only when the specialist itself is at
 * fault, targets a single specialist artifact, and is routed through the governed
 * controller, which holds it to held-out evaluation and human approval. Nothing
 * here applies a change or routes on a score. Reference shape:
 * schemas/specialist-trace.schema.json.
 */
import { governProposal } from './controller.mjs';

export const SPECIALIST_TRACE_SCHEMA_VERSION = 1;

export const FAILURE_CAUSES = Object.freeze([
  'upstream-context',
  'provider-execution',
  'handoff-contract',
  'downstream-consumer',
  'evaluator-uncertainty',
  'specialist-prompt',
  'none',
]);

export const TRIGGER_KINDS = Object.freeze([
  'human-correction',
  'deterministic-failure',
  'repeated-baseline-regression',
  'operator-request',
]);

export const SPECIALIST_TARGETS = Object.freeze(['prompt', 'skill', 'role-flavor', 'routing-rule', 'contract']);

const HUMAN_TARGET_TO_CAUSE = Object.freeze({
  upstream: 'upstream-context',
  contract: 'handoff-contract',
  downstream: 'downstream-consumer',
  provider: 'provider-execution',
  specialist: 'specialist-prompt',
});

/**
 * Attribute a failure to a single cause. External causes are checked before the
 * specialist, so a specialist is blamed only once upstream context, provider
 * execution, the input handoff contract, the downstream consumer, and evaluator
 * certainty are all clean (construct-6zga.1.7 AC1, AC2). A human correction that
 * names a non-specialist cause is authoritative.
 */
export function attributeFailure(trace = {}) {
  const t = trace || {};
  const correctionTarget = t.humanCorrection?.target ?? null;

  if (correctionTarget && correctionTarget !== 'specialist') {
    return { cause: HUMAN_TARGET_TO_CAUSE[correctionTarget] || 'upstream-context', blameSpecialist: false, detail: `human correction -> ${correctionTarget}` };
  }
  if (t.upstream?.evidenceComplete === false || t.upstream?.inputsPresent === false) {
    return { cause: 'upstream-context', blameSpecialist: false, detail: 'upstream evidence or inputs incomplete' };
  }
  if (t.provider?.executionError === true || t.provider?.degraded === true) {
    return { cause: 'provider-execution', blameSpecialist: false, detail: 'provider execution error or degraded' };
  }
  if (t.handoff?.inputValid === false) {
    return { cause: 'handoff-contract', blameSpecialist: false, detail: 'handoff input contract violated' };
  }
  if (t.downstream?.consumerError === true) {
    return { cause: 'downstream-consumer', blameSpecialist: false, detail: 'downstream consumer error' };
  }
  if (t.evaluator?.abstained === true) {
    return { cause: 'evaluator-uncertainty', blameSpecialist: false, detail: 'evaluator abstained' };
  }

  const specialistFault = t.specialistOutput?.evidenceVerdict === 'fail'
    || t.handoff?.schemaValid === false
    || correctionTarget === 'specialist';
  if (specialistFault) {
    return { cause: 'specialist-prompt', blameSpecialist: true, detail: 'specialist output failed with every external cause clean' };
  }
  return { cause: 'none', blameSpecialist: false, detail: 'no attributable failure' };
}

/**
 * The improvement loop is opt-in and bounded: it runs only when explicitly enabled
 * and only for one of the four recognized triggers (construct-6zga.1.7 AC3).
 */
export function shouldTrigger({ kind = null, optIn = false } = {}) {
  return optIn === true && TRIGGER_KINDS.includes(kind);
}

/**
 * Build a scoped improvement proposal for a single specialist artifact — only when
 * the specialist itself is at fault. A non-specialist cause yields no proposal, so
 * an upstream or provider failure never rewrites a specialist (construct-6zga.1.7
 * AC2, AC5).
 */
export function proposeSpecialistChange({ trace = {}, attribution = null, target = 'prompt', baselineVersion = null, candidateVersion = null, heldOutProfiles = [], approver = null } = {}) {
  const attr = attribution || attributeFailure(trace);
  if (!attr.blameSpecialist) return { proposed: false, reason: attr.cause, attribution: attr };

  const profiles = Array.isArray(heldOutProfiles) && heldOutProfiles.length
    ? heldOutProfiles
    : [trace.specialist?.profileId].filter(Boolean);
  const traceIds = Array.isArray(trace.sourceTraceIds) && trace.sourceTraceIds.length
    ? trace.sourceTraceIds
    : [trace.id].filter(Boolean);

  const proposal = {
    schemaVersion: 1,
    id: `prop-${trace.id || 'specialist'}`,
    type: SPECIALIST_TARGETS.includes(target) ? target : 'prompt',
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
      capabilitySnapshot: { capabilityClass: trace.specialist?.capabilityClass || 'unknown' },
      evaluatorVersions: ['gates@1'],
      budgets: null,
    },
    approver: approver ? { identity: approver, approvedAt: null, decision: null } : null,
    rollout: null,
  };
  return { proposed: true, attribution: attr, proposal };
}

/**
 * Run the opt-in specialist improvement loop end to end: gate on the trigger,
 * attribute the failure, and — only when the specialist is at fault — build a
 * scoped proposal and route it through the governed controller for held-out
 * evaluation and human approval. Never applies a change and never routes on a
 * score (construct-6zga.1.7 AC4, AC5).
 */
export function runSpecialistImprovement({
  trace = {}, trigger = null, target = 'prompt', heldOutProfiles = [],
  baselineVersion = null, candidateVersion = null, approver = null,
  dataset = null, evaluationReport = null, knownApprovers = [], resolvedDependencies = [],
} = {}) {
  if (!shouldTrigger(trigger)) return { triggered: false, reason: 'not-triggered' };

  const attribution = attributeFailure(trace);
  if (!attribution.blameSpecialist) return { triggered: true, attribution, proposed: false, reason: attribution.cause };

  const { proposal } = proposeSpecialistChange({ trace, attribution, target, baselineVersion, candidateVersion, heldOutProfiles, approver });
  const governance = governProposal({ proposal, dataset, evaluationReport, knownApprovers, resolvedDependencies });
  return { triggered: true, attribution, proposed: true, proposal, governance };
}

/**
 * Hand-rolled validator (no ajv — Construct stays dependency-free at startup).
 * Returns { valid, errors } against schemas/specialist-trace.schema.json.
 */
export function validateSpecialistTrace(trace) {
  const errors = [];
  if (!trace || typeof trace !== 'object') return { valid: false, errors: ['trace is not an object'] };
  if (trace.schemaVersion !== SPECIALIST_TRACE_SCHEMA_VERSION) errors.push(`schemaVersion must be ${SPECIALIST_TRACE_SCHEMA_VERSION}`);
  if (typeof trace.id !== 'string' || !trace.id) errors.push('id required');
  if (!trace.specialist || typeof trace.specialist.role !== 'string') errors.push('specialist.role required');

  for (const [key, fields] of [
    ['upstream', ['evidenceComplete', 'inputsPresent']],
    ['provider', ['executionError', 'degraded']],
    ['handoff', ['inputValid', 'schemaValid']],
  ]) {
    const block = trace[key];
    if (!block || typeof block !== 'object') { errors.push(`${key} missing`); continue; }
    for (const f of fields) if (typeof block[f] !== 'boolean') errors.push(`${key}.${f} must be boolean`);
  }

  if (!trace.specialistOutput || !['pass', 'fail', 'unverified'].includes(trace.specialistOutput.evidenceVerdict)) {
    errors.push('specialistOutput.evidenceVerdict invalid');
  }
  if (!trace.downstream || !['accepted', 'rejected', 'unknown'].includes(trace.downstream.outcome)) {
    errors.push('downstream.outcome invalid');
  }
  if (!trace.evaluator || typeof trace.evaluator.abstained !== 'boolean') errors.push('evaluator.abstained must be boolean');

  return { valid: errors.length === 0, errors };
}
