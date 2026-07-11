/**
 * lib/embedded-contract/workflow-invoke.mjs — embedded workflow invocation contract.
 *
 * Invokes a named Construct workflow non-interactively and returns a provenanced
 * execution plan: the selected roles (auto/explicit/constrained), each role's
 * rationale, the skills they apply, the resolved model, the evidence the chain
 * requires, the bound persona reasoning framework (ADR-0062), and the output
 * contract to be produced. Construct supplies the orchestration plan and
 * provenance; the host agent runtime performs the specialist reasoning, so
 * the contract never fabricates specialist output.
 *
 * Framework wiring (LMCP-F8, ADR-0062 §3): the primary role's framework is
 * resolved through the same pack registry and tier precedence (E1/ADR-0055)
 * that resolves persona prompts (lib/orchestration/worker.mjs), by matching a
 * pack-declared framework's `appliesToRole` against the role. The resolved
 * framework's ordered `steps` become prompt fragments in the plan, and its
 * `emits` tokens (in step order) are the output contract's required fields —
 * the host runtime that performs the reasoning must return one labeled output
 * per token, in order. A role with no matching framework never falls back to
 * silent generic reasoning: the plan carries `framework: { available: false,
 * degraded: 'framework-missing', role }`, a visible flag a caller can branch
 * on. Traces record `{frameworkId, version, source}` alongside the existing
 * F1 provenance fields so a downstream audit can tell which reasoning
 * procedure (if any) governed the run.
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
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getDeploymentMode } from '../deployment-mode.mjs';
import { addObservation } from '../observation-store.mjs';
import { recordApprovalRequest } from '../roles/approval-surface.mjs';
import { loadAllPacks } from '../packs/loader.mjs';
import { resolveFramework } from '../frameworks/loader.mjs';
import { parseFrameworkFile } from '../frameworks/schema.mjs';
import { getWorkflowDef, WORKFLOW_TYPES } from './workflow-defs.mjs';
import { recruit } from '../orchestration/recruiter.mjs';
import { requestSignals } from '../orchestration/flow-selection.mjs';
import { roleMap, roleRationale, skillsForChain, contractFacts } from './role-facts.mjs';
import { resolveEmbeddedModel } from './model-resolve.mjs';
import { resolveExecution } from './execution.mjs';
import { resolveWriteGate, newTraceId, DEFAULT_APPROVAL_MODE } from './audit.mjs';

const VALID_STRATEGIES = ['auto', 'explicit', 'constrained'];

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(HERE, '..', '..');

// Mirrors lib/orchestration/worker.mjs sortByTierPrecedence: a project pack's
// framework for a role must win over a builtin pack's framework for the same
// role, not just over another version of the same pack id (ADR-0055).

const PACK_TIER_RANK = { project: 0, user: 1, builtin: 2, unknown: 3 };

function sortByTierPrecedence(packs) {
  return [...packs].sort((a, b) => (PACK_TIER_RANK[a._tier] ?? 3) - (PACK_TIER_RANK[b._tier] ?? 3));
}

/**
 * Find the frameworkId a pack registry binds to a role, honoring tier
 * precedence. A framework equips a role via its own frontmatter
 * `appliesToRole` (ADR-0062 §2) — there is no separate specialist→framework
 * map to consult, so packs are walked in precedence order and the first
 * framework file whose parsed `appliesToRole` matches wins.
 *
 * @param {string} roleId   bare role id, e.g. 'product-manager'
 * @param {object[]} packs  tier-precedence ordered pack list
 * @param {string} packageRoot
 * @returns {string|null}
 */
function frameworkIdForRole(roleId, packs, packageRoot) {
  for (const pack of packs) {
    const frameworks = pack?.frameworks || {};
    const root = pack?._packDir || packageRoot;
    for (const [frameworkId, relPath] of Object.entries(frameworks)) {
      if (typeof relPath !== 'string' || !relPath) continue;
      const parsed = parseFrameworkFile(join(root, relPath));
      if (parsed.valid && parsed.frontmatter?.appliesToRole === roleId) return frameworkId;
    }
  }
  return null;
}

/**
 * Resolve the persona reasoning framework bound to a role through the pack
 * registry (E1 precedence), or a visible degradation flag when no pack
 * declares one for this role — never a silent fallback to generic reasoning
 * (ADR-0062 §3).
 *
 * @param {string} roleId
 * @param {object} opts
 * @param {object} opts.env
 * @param {string} opts.cwd
 * @returns {{available:true, frameworkId:string, version:*, source:string, steps:object[], requiredOutputFields:string[]} | {available:false, degraded:'framework-missing', role:string}}
 */
function resolveRoleFramework(roleId, { env, cwd }) {
  const deploymentMode = getDeploymentMode(env, { cwd });
  const { packs } = loadAllPacks({ deploymentMode, env, rootDir: cwd, packageRoot: PACKAGE_ROOT });
  const ordered = sortByTierPrecedence(packs);

  const frameworkId = frameworkIdForRole(roleId, ordered, PACKAGE_ROOT);
  if (!frameworkId) {
    return { available: false, degraded: 'framework-missing', role: roleId };
  }

  const resolved = resolveFramework(frameworkId, { packs: ordered, packageRoot: PACKAGE_ROOT });
  if (!resolved.found) {
    return { available: false, degraded: 'framework-missing', role: roleId };
  }

  const steps = (resolved.frontmatter.steps || []).map((step) => ({
    id: step.id,
    move: step.move,
    question: step.question,
    emits: step.emits,
    cites: step.cites,
  }));

  return {
    available: true,
    frameworkId: resolved.frontmatter.id,
    version: resolved.frontmatter.version,
    source: resolved.packId,
    steps,
    requiredOutputFields: steps.map((s) => s.emits),
  };
}

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

// Manifest roleChain is a floor, not a ceiling (construct-pteo2.9): request
// signals recruit additional reviewers onto the selected chain via the
// generalized recruiter (ADR-0070's third insertion point). The manifest
// chain is never shrunk; recruits append after it. mode 'off' is the caller
// override; a recruitment failure leaves the chain unchanged, advisory only.

function resolveWorkflowRecruitment({ input, selectedRoles, map, mode, warnings }) {
  if (mode === 'off') {
    return { recruited: [], addedRoles: [], rationale: ['recruitment: off (caller override)'] };
  }
  try {
    const signals = requestSignals(String(input || ''));
    const recruited = recruit({
      signals,
      kind: 'review',
      exclude: selectedRoles.map((r) => `cx-${r}`),
    });
    const addedRoles = [];
    const rationale = [];
    for (const p of recruited) {
      if (!p.specialist) continue;
      const role = p.specialist.replace(/^cx-/, '');
      if (selectedRoles.includes(role) || addedRoles.includes(role)) continue;
      if (!map.has(role)) {
        warnings.push(`recruitment: recruited role id unknown to the role map, skipped: ${role}.`);
        continue;
      }
      addedRoles.push(role);
      rationale.push(`${p.specialist} recruited as ${p.role} (${p.gate}): ${p.reason}`);
    }
    return { recruited, addedRoles, rationale };
  } catch (err) {
    warnings.push(`recruitment: evaluation failed (${err.message}); manifest chain unchanged.`);
    return { recruited: [], addedRoles: [], rationale: [] };
  }
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
    framework: null,
    outputs: null,
    recommendations: [],
    evidence: { requirements: [], satisfied: [], traceId },
    risks: { level: 'unknown', factors: [] },
    requiresApproval: false,
    approvalMode: approvalMode || DEFAULT_APPROVAL_MODE,
    durableWritesPerformed: [],
    traceId,
    trace: { role: null, frameworkId: null, frameworkVersion: null, frameworkSource: null, degraded: null },
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
 * @param {string} [request.recruitment]      auto (default) | off — signal-driven recruits append to the selected chain (construct-pteo2.9)
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

  const recruitment = resolveWorkflowRecruitment({
    input: request.input,
    selectedRoles,
    map,
    mode: request.recruitment,
    warnings,
  });
  selectedRoles.push(...recruitment.addedRoles);

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

  // The bound framework equips the plan's primary role only — the role the
  // output contract and evidence requirements are already scoped to
  // (contractFacts(primaryOwner) above) — not every role in the chain.

  const framework = resolveRoleFramework(primaryOwner, { env, cwd });
  if (!framework.available) {
    warnings.push(`framework: no reasoning framework bound for role '${primaryOwner}'; proceeding without a reasoning scaffold (degraded: framework-missing).`);
  }

  // Evidence is satisfied only when a requirement key is actually present in the
  // caller-supplied context; missing requirements are reported, never assumed.

  const contextKeys = new Set(Object.keys(context || {}));
  const satisfied = facts.evidenceRequirements.filter((req) => contextKeys.has(req));
  const missingEvidence = facts.evidenceRequirements.filter((req) => !contextKeys.has(req));

  const deploymentMode = getDeploymentMode(env, { cwd });
  const mode = approvalMode || def.defaultApprovalMode;
  const gate = resolveWriteGate({ approvalMode: mode, deploymentMode });

  // requiredOutputFields carries the framework's `emits` tokens IN STEP ORDER
  // (ADR-0062 §3): the host runtime must return one labeled output per token,
  // in that order, so the reasoning procedure is checkable, not just prose.

  const outputs = {
    schema: def.outputSchema,
    expected: facts.expectedOutputs,
    requiredOutputFields: framework.available ? framework.requiredOutputFields : [],
    note: 'Construct returns the orchestration plan and output contract; specialist reasoning is performed by the host agent runtime.',
  };
  const recommendations = [`Run roles in order: ${selectedRoles.map((r) => `cx-${r}`).join(' → ')}.`];
  if (missingEvidence.length) recommendations.push(`Supply missing evidence before execution: ${missingEvidence.join(', ')}.`);

  const riskFactors = [];
  if (missingEvidence.length) riskFactors.push(`missing required evidence: ${missingEvidence.join(', ')}`);
  if (modelResolution.error) riskFactors.push(`model could not be resolved: ${modelResolution.error.reason}`);
  if (!framework.available) riskFactors.push(`no reasoning framework bound for role '${primaryOwner}' (degraded: framework-missing)`);
  const risks = {
    level: missingEvidence.length || modelResolution.error || !framework.available ? 'medium' : 'low',
    factors: riskFactors,
  };

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
      // The durable trace must carry the recruited set WITH its reasons
      // (construct-pteo2.18 cross-surface parity) — roles= alone shows who was
      // added but a later audit could not tell why without re-deriving signals.
      const recruitmentLine = recruitment.addedRoles.length
        ? `; recruited=${recruitment.addedRoles.join(',')}; recruitmentRationale=${recruitment.rationale.join(' | ')}`
        : '';
      const obs = await addObservation(cwd, {
        role: primaryOwner,
        category: 'decision',
        summary: `Embedded workflow invoked: ${workflowType}`,
        content: `roles=${selectedRoles.join(',')}; tier=${def.tier}; model=${modelResolution.selectedModel || 'unresolved'}; traceId=${traceId}${recruitmentLine}`,
        tags: ['embedded-contract', `workflow/${workflowType}`],
        source: 'embedded-contract',
      });
      durableWritesPerformed.push({ kind: 'observation', id: obs?.id ?? null, store: '.construct/observations', audited: gate.mandatoryAudit });
    } catch (err) {
      errors.push({ code: 'DURABLE_WRITE_FAILED', message: err.message });
    }
    status = errors.length ? 'error' : 'recorded';
  } else {
    status = 'proposed';
  }

  // Trace provenance (LMCP-F1 alignment): a downstream audit reads
  // {frameworkId, frameworkVersion, frameworkSource} off the trace to know
  // which reasoning procedure (if any) governed this run, the same way F1
  // already records {specialistId, packId, promptVersion} for the persona
  // that ran. traceId itself is already carried (and correlated) at the top
  // level, so it is not duplicated here.

  const traceProvenance = {
    role: primaryOwner,
    frameworkId: framework.available ? framework.frameworkId : null,
    frameworkVersion: framework.available ? framework.version : null,
    frameworkSource: framework.available ? framework.source : null,
    degraded: framework.available ? null : framework.degraded,
  };

  return {
    workflowId,
    workflowType,
    status,
    ingestion,
    selectedRoles,
    roleStrategy: strategy,
    roleRationale: rationale,
    recruitment: {
      recruited: recruitment.recruited,
      addedRoles: recruitment.addedRoles,
      rationale: recruitment.rationale,
    },
    skillsApplied,
    modelResolution,
    execution,
    framework,
    outputs,
    recommendations,
    evidence: { requirements: facts.evidenceRequirements, satisfied, missing: missingEvidence, traceId },
    risks,
    requiresApproval: gate.requiresApproval,
    approvalMode: gate.approvalMode,
    durableWritesPerformed,
    traceId,
    trace: traceProvenance,
    errors,
    warnings,
  };
}
