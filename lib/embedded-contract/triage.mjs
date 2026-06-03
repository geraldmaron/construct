/**
 * lib/embedded-contract/triage.mjs — embedded triage and planning contract.
 *
 * Classifies an artifact and returns a role-aware plan without enqueuing or
 * executing anything. Wraps the deterministic classifier (lib/intake/classify)
 * and enriches it from real sources only: the role catalog supplies role
 * rationale and skills, the specialist contracts supply evidence requirements
 * and expected outputs. Classification confidence (how sure the classifier is)
 * is reported as a distinct, labeled field from any downstream generation
 * confidence, which is produced only when a workflow actually runs.
 *
 * Pure and side-effect-free: no queue write, no disk artifact, no model call.
 */

import { classifyRdIntake } from '../intake/classify.mjs';
import { getDeploymentMode } from '../deployment-mode.mjs';
import { roleMap, roleRationale, skillsForChain, contractFacts } from './role-facts.mjs';
import { workflowTypeForIntake } from './workflow-defs.mjs';
import { resolveExecution } from './execution.mjs';

const CONFIDENCE_FLOOR = 0.6;

function buildRiskFactors(triage) {
  const factors = [];
  if (triage.intakeType === 'unknown') factors.push('classification is unknown — no keywords matched');
  if (typeof triage.confidence === 'number' && triage.confidence < CONFIDENCE_FLOOR) {
    factors.push(`low classification confidence (${triage.confidence.toFixed(2)})`);
  }
  const ambiguous = (triage.rationale || '').includes('ambiguous');
  if (ambiguous) factors.push('top two classifications are close (ambiguous)');
  return factors;
}

/**
 * Produce a role-aware plan for an artifact without enqueuing or executing it.
 *
 * @param {object} request
 * @param {string} [request.input]          Artifact text to classify.
 * @param {string} [request.sourcePath]     Filename/source hint for the classifier.
 * @param {string} [request.artifactType]   Optional artifact-type hint (advisory).
 * @param {string} [request.domain]
 * @param {string} [request.desiredOutcome]
 * @param {string[]} [request.constraints]
 * @param {string[]} [request.availableRoles]  Restrict the plan to these role ids.
 * @param {object} [request.profile]
 * @param {object} [opts]   { env, cwd }
 * @returns {object}
 */
export function recommendPlan(request = {}, { env = process.env, cwd = process.cwd() } = {}) {
  const { input = '', sourcePath = '', artifactType, availableRoles, profile = null, ingestion = null, host, hostModel, hostProvider, constructStrategy = 'auto' } = request;
  const warnings = [];

  // Surface extraction provenance and flag low-yield/truncated inputs so a
  // sparse classification is attributable to thin source text, not silent loss.

  if (ingestion) {
    if (ingestion.error) warnings.push(`ingestion: ${ingestion.error.code} — ${ingestion.error.reason}`);
    for (const drop of ingestion.droppedInfo || []) {
      warnings.push(`ingestion: ${drop.kind || 'dropped-content'}${drop.recoverable ? ' (recoverable)' : ''}.`);
    }
    if (ingestion.truncated) warnings.push('ingestion: source text was truncated before classification.');
    if (ingestion.note) warnings.push(`ingestion: ${ingestion.note}`);
  }

  const triage = classifyRdIntake({ sourcePath: sourcePath || (artifactType ? `${artifactType}.md` : ''), extractedText: input, profile });
  const roles = roleMap();

  let chain = [...(triage.recommendedChain || [])];
  const primaryOwner = triage.primaryOwner;

  if (Array.isArray(availableRoles) && availableRoles.length) {
    const allowed = new Set(availableRoles);
    const dropped = chain.filter((r) => !allowed.has(r));
    if (dropped.length) warnings.push(`Roles not in availableRoles were dropped from the chain: ${dropped.join(', ')}.`);
    chain = chain.filter((r) => allowed.has(r));
    if (primaryOwner && !allowed.has(primaryOwner)) {
      warnings.push(`Primary owner ${primaryOwner} is not in availableRoles; the plan cannot be executed as recommended.`);
    }
  }

  const rationale = roleRationale(chain, roles);
  const suggestedSkills = skillsForChain(chain, roles);

  const { evidenceRequirements, expectedOutputs } = contractFacts(primaryOwner);
  if (!evidenceRequirements.length) {
    warnings.push(`No declared evidence contract for cx-${primaryOwner}; evidence requirements are unspecified.`);
  }

  const deploymentMode = getDeploymentMode(env, { cwd });
  const requiresApproval = Boolean(triage.requiresApproval) || deploymentMode === 'enterprise';
  const approvalRequirements = {
    requiresApproval,
    reason: triage.requiresApproval
      ? 'The classified work type requires approval before durable changes.'
      : (deploymentMode === 'enterprise' ? 'Enterprise deployment mode mandates approval for durable changes.' : 'No approval required before proposing changes.'),
  };

  const ownerAvailable = !primaryOwner || !Array.isArray(availableRoles) || !availableRoles.length || availableRoles.includes(primaryOwner);
  const canExecute = triage.intakeType !== 'unknown'
    && typeof triage.confidence === 'number' && triage.confidence >= CONFIDENCE_FLOOR
    && chain.length > 0
    && ownerAvailable;
  const canExecuteReason = canExecute
    ? 'Classification is confident and maps to a role chain that can be invoked.'
    : 'Execution is not recommended: classification is unknown, low-confidence, or no usable role chain remains.';

  const nextStepOptions = [
    { action: 'enqueue', description: 'Add to the intake queue for processing (construct intake process).' },
  ];
  if (canExecute) nextStepOptions.push({ action: 'invoke-workflow', description: 'Invoke the recommended role chain as an embedded workflow.' });
  if (!canExecute) nextStepOptions.push({ action: 'clarify', description: 'Request more detail; classification confidence is low or unknown.' });

  const suggestedWorkflowType = workflowTypeForIntake(triage.intakeType);

  // Execution preview: forecast the executionMode an invocation of the suggested
  // workflow would resolve to, but only when the host supplies context — absent
  // it, forcing a model resolution on every triage call would be wasteful and
  // the preview would be uninformative. null keeps the field parity-stable.
  let execution = null;
  if (suggestedWorkflowType && (hostModel || hostProvider || (constructStrategy && constructStrategy !== 'auto'))) {
    const e = resolveExecution({ workflowType: suggestedWorkflowType, requestedStrategy: constructStrategy, host, hostModel, hostProvider }, { env, cwd });
    execution = {
      executionMode: e.executionMode,
      effectiveStrategy: e.effectiveStrategy,
      requestedStrategy: e.requestedStrategy,
      constructCapabilitiesActive: e.constructCapabilitiesActive,
      degraded: e.degraded,
      degradationReason: e.degradationReason,
      semantics: e.semantics,
    };
  }

  return {
    classification: { intakeType: triage.intakeType, rdStage: triage.rdStage },
    ingestion,
    confidenceKind: 'classification',
    classificationConfidence: triage.confidence,
    primaryOwner,
    recommendedAction: triage.recommendedAction,
    recommendedChain: chain,
    suggestedWorkflowType,
    execution,
    roleRationale: rationale,
    suggestedSkills,
    evidenceRequirements,
    expectedOutputs,
    approvalRequirements,
    risks: { level: triage.risk || 'unknown', factors: buildRiskFactors(triage) },
    nextStepOptions,
    canExecute,
    canExecuteReason,
    rationale: triage.rationale,
    candidates: triage.candidates || [],
    warnings,
  };
}
