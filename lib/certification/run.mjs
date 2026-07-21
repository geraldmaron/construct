/**
 * lib/certification/run.mjs — certification run record validation and verdict rules.
 *
 * Hand-rolled validator aligned with schemas/certification-run.schema.json. Skipped
 * provider calls must persist as inconclusive and can never be promoted to pass.
 */

export const CERTIFICATION_RUN_SCHEMA_VERSION = 1;

export const VERDICT_STATUSES = Object.freeze(['pass', 'fail', 'inconclusive']);
export const VERDICT_SOURCES = Object.freeze(['deterministic', 'qualitative', 'skipped-provider', 'error']);
export const MODEL_TIERS = Object.freeze(['free', 'paid-reference', 'hermetic', 'unknown']);

function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function deriveVerdictFromExecution({ gates = [], providerSkipped = false, qualitative = null, error = null } = {}) {
  if (providerSkipped || error) {
    return {
      status: 'inconclusive',
      source: providerSkipped ? 'skipped-provider' : 'error',
      reason: providerSkipped ? 'provider call skipped' : String(error),
    };
  }
  if (gates.some((gate) => gate?.pass === false)) {
    return { status: 'fail', source: 'deterministic', reason: 'deterministic gate regression' };
  }
  if (qualitative?.abstained) {
    return { status: 'inconclusive', source: 'qualitative', reason: 'qualitative judge abstained' };
  }
  if (typeof qualitative?.score === 'number' && qualitative.score < 0.5) {
    return { status: 'fail', source: 'qualitative', reason: 'qualitative score below threshold' };
  }
  return { status: 'pass', source: qualitative ? 'qualitative' : 'deterministic', reason: null };
}

export function validateCertificationRun(run) {
  const errors = [];
  if (!run || typeof run !== 'object') return { valid: false, errors: ['run is not an object'] };

  if (run.schemaVersion !== CERTIFICATION_RUN_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${CERTIFICATION_RUN_SCHEMA_VERSION}`);
  }
  if (!hasText(run.id)) errors.push('id required');
  if (!hasText(run.scenarioId)) errors.push('scenarioId required');
  if (!hasText(run.capabilityId)) errors.push('capabilityId required');
  if (!hasText(run.evidenceVersion)) errors.push('evidenceVersion required');
  if (!hasText(run.createdAt)) errors.push('createdAt required');

  const model = run.model;
  if (!model || typeof model !== 'object') errors.push('model required');
  else {
    if (!hasText(model.provider)) errors.push('model.provider required');
    if (!hasText(model.requestedId)) errors.push('model.requestedId required');
    if (!hasText(model.resolvedId)) errors.push('model.resolvedId required');
    if (!MODEL_TIERS.includes(model.tier)) errors.push(`model.tier invalid: ${model.tier}`);
    if (model.tier === 'paid-reference' && model.paidOptIn === true && !hasText(model.operatorAckAt)) {
      errors.push('model.operatorAckAt required when paid-reference tier has paidOptIn');
    }
  }

  const fixture = run.fixture;
  if (!fixture || typeof fixture !== 'object') errors.push('fixture required');
  else {
    if (!hasText(fixture.path)) errors.push('fixture.path required');
    if (!/^[a-f0-9]{64}$/.test(fixture.sha256 ?? '')) errors.push('fixture.sha256 must be a sha256 hex digest');
  }

  const verdict = run.verdict;
  if (!verdict || typeof verdict !== 'object') errors.push('verdict required');
  else {
    if (!VERDICT_STATUSES.includes(verdict.status)) errors.push(`verdict.status invalid: ${verdict.status}`);
    if (!VERDICT_SOURCES.includes(verdict.source)) errors.push(`verdict.source invalid: ${verdict.source}`);
    if (verdict.source === 'skipped-provider' && verdict.status === 'pass') {
      errors.push('skipped-provider verdict cannot be pass');
    }
    if (verdict.source === 'skipped-provider' && verdict.status !== 'inconclusive') {
      errors.push('skipped-provider verdict must be inconclusive');
    }
  }

  if (!Array.isArray(run.gates)) errors.push('gates must be an array');
  else {
    for (const gate of run.gates) {
      if (!hasText(gate?.id)) errors.push('gate.id required');
      if (typeof gate?.pass !== 'boolean') errors.push(`${gate?.id ?? 'gate'}: pass must be boolean`);
    }
  }

  if (run.evaluation != null) {
    if (typeof run.evaluation !== 'object') errors.push('evaluation must be an object when present');
    else if (run.evaluation.decision != null && typeof run.evaluation.decision.promotable !== 'boolean') {
      errors.push('evaluation.decision.promotable must be boolean when present');
    }
  }

  const timing = run.timing;
  if (!timing || typeof timing !== 'object') errors.push('timing required');
  else if (typeof timing.latencyMs !== 'number' || timing.latencyMs < 0) errors.push('timing.latencyMs must be >= 0');

  if (run.cost != null) {
    if (typeof run.cost !== 'object') errors.push('cost must be an object when present');
    else if (run.cost.totalUsd != null && typeof run.cost.totalUsd !== 'number') errors.push('cost.totalUsd must be a number');
  }

  if (run.variance != null) {
    if (typeof run.variance !== 'object') errors.push('variance must be an object when present');
    else if (run.variance.scoreStdDev != null && typeof run.variance.scoreStdDev !== 'number') {
      errors.push('variance.scoreStdDev must be a number');
    }
  }

  if (run.artifacts != null) {
    for (const value of Object.values(run.artifacts)) {
      if (value != null && typeof value === 'string' && /secret|api[_-]?key|token=/i.test(value)) {
        errors.push('artifacts must not embed secret material');
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

export function assertCertificationRun(run) {
  const result = validateCertificationRun(run);
  if (!result.valid) throw new Error(result.errors.join('; '));
  return run;
}
