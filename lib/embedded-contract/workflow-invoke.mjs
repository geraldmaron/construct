/**
 * lib/embedded-contract/workflow-invoke.mjs — embedded workflow invocation contract.
 *
 * Invokes a named Construct workflow non-interactively and returns a provenanced
 * execution plan: the selected roles (auto/explicit/constrained), each role's
 * rationale, the skills they apply, the resolved model, the evidence the chain
 * requires, and the output contract it will produce. Construct supplies the
 * orchestration plan and provenance; the host agent runtime performs the
 * specialist reasoning — so this contract never fabricates specialist output.
 *
 * Durable side effects are gated by approval mode (resolveWriteGate):
 *   - proposal-only           → status 'proposed', zero writes
 *   - requires-human-approval → status 'awaiting-approval', an approval request
 *                               is recorded, zero durable writes
 *   - allow-durable-write     → status 'recorded', the invocation is written to
 *                               the observation store as durable provenance
 * On team/enterprise deployments, durable writes are flagged as mandatorily
 * audited. A traceId correlates the call with downstream provenance.
 */

import { randomUUID } from 'node:crypto';

import { getDeploymentMode } from '../deployment-mode.mjs';
import { addObservation } from '../observation-store.mjs';
import { recordApprovalRequest } from '../roles/approval-surface.mjs';
import { getWorkflowDef, WORKFLOW_TYPES } from './workflow-defs.mjs';
import { roleMap, roleRationale, skillsForChain, contractFacts } from './role-facts.mjs';
import { resolveEmbeddedModel } from './model-resolve.mjs';
import { resolveExecution } from './execution.mjs';
import { resolveWriteGate, newTraceId, DEFAULT_APPROVAL_MODE } from './audit.mjs';

const VALID_STRATEGIES = ['auto', 'explicit', 'constrained'];

function selectRoles({ strategy, defChain, requestedRoles, map, warnings }) {
  const filterKnown = (ids) => ids.filter((id) => {
    if (map.has(id)) return true;
    warnings.push(`Unknown role id ignored: ${id}.`);
    return false;
  });

  if (strategy === 'explicit') {
    if (!Array.isArray(requestedRoles) || requestedRoles.length === 0) {
      warnings.push('roleStrategy=explicit requires requestedRoles; using the workflow default chain.');
      return [...defChain];
    }
    return filterKnown(requestedRoles);
  }
  if (strategy === 'constrained') {
    const allowed = new Set(requestedRoles || []);
    const dropped = defChain.filter((id) => !allowed.has(id));
    if (dropped.length) warnings.push(`Constrained: roles outside requestedRoles dropped from the default chain: ${dropped.join(', ')}.`);
    return defChain.filter((id) => allowed.has(id));
  }
  return [...defChain];
}

function errorResult({ workflowId, traceId, approvalMode, code, message, warnings }) {
  return {
    workflowId,
    status: 'error',
    selectedRoles: [],
    roleStrategy: null,
    roleRationale: [],
    skillsApplied: [],
    modelResolution: null,
    outputs: null,
    recommendations: [],
    evidence: { requirements: [], satisfied: [], traceId },
    risks: { level: 'unknown', factors: [] },
    requiresApproval: false,
    approvalMode: approvalMode || DEFAULT_APPROVAL_MODE,
    durableWritesPerformed: [],
    traceId,
    errors: [{ code, message }],
    warnings,
  };
}

/**
 * Invoke an embedded workflow. Async because durable provenance and approval
 * records are written through existing stores. Returns a result object carrying
 * a `warnings` array (lifted into the envelope by the calling surface).
 *
 * @param {object} request
 * @param {string} request.workflowType
 * @param {string} [request.input]
 * @param {object} [request.context]
 * @param {string} [request.roleStrategy]    auto | explicit | constrained
 * @param {string[]} [request.requestedRoles]
 * @param {string} [request.approvalMode]     proposal-only | requires-human-approval | allow-durable-write
 * @param {boolean} [request.trace=true]
 * @param {string} [request.host]
 * @param {string} [request.hostModel]
 * @param {string} [request.hostProvider]
 * @param {string} [request.constructStrategy]  orchestrated | prompt-only | auto (execution mode)
 * @param {object} [opts]   { env, cwd }
 * @returns {Promise<object>}
 */
export async function invokeWorkflow(request = {}, { env = process.env, cwd = process.cwd() } = {}) {
  const {
    workflowType, context = {}, roleStrategy = 'auto', requestedRoles,
    approvalMode, trace = true, host, hostModel, hostProvider, ingestion = null,
    constructStrategy = 'auto',
  } = request;
  const warnings = [];
  if (ingestion) {
    if (ingestion.error) warnings.push(`ingestion: ${ingestion.error.code} — ${ingestion.error.reason}`);
    for (const drop of ingestion.droppedInfo || []) warnings.push(`ingestion: ${drop.kind || 'dropped-content'}${drop.recoverable ? ' (recoverable)' : ''}.`);
    if (ingestion.truncated) warnings.push('ingestion: source text was truncated before invocation.');
    if (ingestion.note) warnings.push(`ingestion: ${ingestion.note}`);
  }
  const traceId = trace ? newTraceId() : null;
  const workflowId = `wf-${randomUUID()}`;

  const def = getWorkflowDef(workflowType);
  if (!def) {
    return errorResult({ workflowId, traceId, approvalMode, code: 'UNKNOWN_WORKFLOW_TYPE', message: `Unknown workflowType "${workflowType}". Known: ${WORKFLOW_TYPES.join(', ')}.`, warnings });
  }

  const strategy = VALID_STRATEGIES.includes(roleStrategy) ? roleStrategy : 'auto';
  if (strategy !== roleStrategy) warnings.push(`Unknown roleStrategy "${roleStrategy}"; defaulting to auto.`);

  const map = roleMap();
  const selectedRoles = selectRoles({ strategy, defChain: def.chain, requestedRoles, map, warnings });
  if (selectedRoles.length === 0) {
    return errorResult({ workflowId, traceId, approvalMode, code: 'NO_ROLES_SELECTED', message: 'Role selection produced an empty chain.', warnings });
  }

  const { warnings: modelWarnings = [], ...modelResolution } = resolveEmbeddedModel(
    { workflowType, requestedTier: def.tier, host, hostModel, hostProvider },
    { env },
  );
  for (const w of modelWarnings) warnings.push(`model-resolution: ${w}`);

  // The execution-capability contract reports the PLANNED executionMode for this
  // run (descriptive, not enforced — ADR-0019). Construct returns a plan; the
  // host runtime executes it, so this never claims observed specialist execution.
  const executionData = resolveExecution(
    { workflowType, requestedStrategy: constructStrategy, host, hostModel, hostProvider, requestedTier: def.tier },
    { env, cwd },
  );
  const execution = {
    executionMode: executionData.executionMode,
    effectiveStrategy: executionData.effectiveStrategy,
    requestedStrategy: executionData.requestedStrategy,
    constructCapabilitiesActive: executionData.constructCapabilitiesActive,
    degraded: executionData.degraded,
    degradationReason: executionData.degradationReason,
    semantics: executionData.semantics,
  };

  const primaryOwner = selectedRoles[0];
  const facts = contractFacts(primaryOwner);
  const skillsApplied = skillsForChain(selectedRoles, map);
  const rationale = roleRationale(selectedRoles, map);

  // Evidence is satisfied only when a requirement key is actually present in the
  // caller-supplied context; missing requirements are reported, never assumed.

  const contextKeys = new Set(Object.keys(context || {}));
  const satisfied = facts.evidenceRequirements.filter((req) => contextKeys.has(req));
  const missingEvidence = facts.evidenceRequirements.filter((req) => !contextKeys.has(req));

  const deploymentMode = getDeploymentMode(env, { cwd });
  const mode = approvalMode || def.defaultApprovalMode;
  const gate = resolveWriteGate({ approvalMode: mode, deploymentMode });

  const outputs = {
    schema: def.outputSchema,
    expected: facts.expectedOutputs,
    note: 'Construct returns the orchestration plan and output contract; specialist reasoning is performed by the host agent runtime.',
  };
  const recommendations = [`Run roles in order: ${selectedRoles.map((r) => `cx-${r}`).join(' → ')}.`];
  if (missingEvidence.length) recommendations.push(`Supply missing evidence before execution: ${missingEvidence.join(', ')}.`);

  const riskFactors = [];
  if (missingEvidence.length) riskFactors.push(`missing required evidence: ${missingEvidence.join(', ')}`);
  if (modelResolution.error) riskFactors.push(`model could not be resolved: ${modelResolution.error.reason}`);
  const risks = { level: missingEvidence.length || modelResolution.error ? 'medium' : 'low', factors: riskFactors };

  const durableWritesPerformed = [];
  const errors = [];
  let status;

  if (gate.requiresApproval) {
    try {
      await recordApprovalRequest({
        personaId: primaryOwner,
        action: `embedded-workflow:${workflowType}`,
        target: workflowId,
        reason: `Embedded workflow ${workflowType} awaiting human approval.`,
        context: { workflowType, selectedRoles, traceId },
      });
    } catch (err) {
      warnings.push(`Could not record approval request: ${err.message}`);
    }
    status = 'awaiting-approval';
  } else if (gate.allowWrites) {
    try {
      const obs = await addObservation(cwd, {
        role: primaryOwner,
        category: 'decision',
        summary: `Embedded workflow invoked: ${workflowType}`,
        content: `roles=${selectedRoles.join(',')}; tier=${def.tier}; model=${modelResolution.selectedModel || 'unresolved'}; traceId=${traceId}`,
        tags: ['embedded-contract', `workflow/${workflowType}`],
        source: 'embedded-contract',
      });
      durableWritesPerformed.push({ kind: 'observation', id: obs?.id ?? null, store: '.cx/observations', audited: gate.mandatoryAudit });
    } catch (err) {
      errors.push({ code: 'DURABLE_WRITE_FAILED', message: err.message });
    }
    status = errors.length ? 'error' : 'recorded';
  } else {
    status = 'proposed';
  }

  return {
    workflowId,
    workflowType,
    status,
    ingestion,
    selectedRoles,
    roleStrategy: strategy,
    roleRationale: rationale,
    skillsApplied,
    modelResolution,
    execution,
    outputs,
    recommendations,
    evidence: { requirements: facts.evidenceRequirements, satisfied, missing: missingEvidence, traceId },
    risks,
    requiresApproval: gate.requiresApproval,
    approvalMode: gate.approvalMode,
    durableWritesPerformed,
    traceId,
    errors,
    warnings,
  };
}
