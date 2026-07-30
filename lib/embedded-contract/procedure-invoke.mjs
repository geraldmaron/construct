/**
 * Embedded Procedure invocation contract.
 *
 * Invokes a named Construct Procedure non-interactively and returns a provenanced
 * execution plan: the selected roles (auto/explicit/constrained), each role's
 * rationale, the skills they apply, the resolved model, the evidence the chain
 * requires, the bound persona reasoning framework, and the output
 * contract to be produced. Construct supplies the orchestration plan and
 * provenance; the host agent runtime performs the specialist reasoning, so
 * the contract never fabricates specialist output.
 *
 * Framework wiring: the primary role's framework is
 * resolved through the same pack registry and tier precedence
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
import { recordApprovalNotice } from '../writes/authority-ledger.mjs';
import { loadAllPacks } from '../packs/loader.mjs';
import { resolveFramework } from '../frameworks/loader.mjs';
import { parseFrameworkFile } from '../frameworks/schema.mjs';
import { getProcedureDefinition, PROCEDURE_IDS } from './procedure-definitions.mjs';
import { recruit } from '../orchestration/recruiter.mjs';
import { requestSignals } from '../orchestration/flow-selection.mjs';
import { workerProfileMap, workerProfileRationale, skillsForWorkerProfiles, contractFacts } from './worker-profile-facts.mjs';
import { resolveEmbeddedModel } from './model-resolve.mjs';
import { resolveExecution } from './execution.mjs';
import { resolveWriteGate, newTraceId, DEFAULT_APPROVAL_MODE } from './audit.mjs';
import { withInvokePlanLifecycle } from '../artifact-lifecycle.mjs';

const VALID_STRATEGIES = ['auto', 'explicit', 'constrained'];

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(HERE, '..', '..');

// Mirrors lib/orchestration/worker.mjs sortByTierPrecedence: a project pack's
// framework for a role must win over a builtin pack's framework for the same
// role, not just over another version of the same pack id.

const PACK_TIER_RANK = { project: 0, user: 1, builtin: 2, unknown: 3 };

function sortByTierPrecedence(packs) {
  return [...packs].sort((a, b) => (PACK_TIER_RANK[a._tier] ?? 3) - (PACK_TIER_RANK[b._tier] ?? 3));
}

/**
 * Find the frameworkId a pack registry binds to a role, honoring tier
 * precedence. A framework equips a role via its own frontmatter
 * `appliesToRole` — there is no separate specialist→framework
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
 * declares one for this role — never a silent fallback to generic reasoning.
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

function selectWorkerProfiles({ strategy, defaults, requestedWorkerProfiles, map, warnings }) {
  const filterKnown = (ids) => ids.filter((id) => {
    if (map.has(id)) return true;
    warnings.push(`Unknown Worker Profile id ignored: ${id}.`);
    return false;
  });

  if (strategy === 'explicit') {
    if (!Array.isArray(requestedWorkerProfiles) || requestedWorkerProfiles.length === 0) {
      warnings.push('workerProfileStrategy=explicit requires requestedWorkerProfiles; using the Procedure defaults.');
      return [...defaults];
    }
    return filterKnown(requestedWorkerProfiles);
  }
  if (strategy === 'constrained') {
    const allowed = new Set(requestedWorkerProfiles || []);
    const dropped = defaults.filter((id) => !allowed.has(id));
    if (dropped.length) warnings.push(`Constrained: Worker Profiles outside requestedWorkerProfiles dropped from the Procedure defaults: ${dropped.join(', ')}.`);
    return defaults.filter((id) => allowed.has(id));
  }
  return [...defaults];
}

// Manifest roleChain is a floor, not a ceiling: request
// signals recruit additional reviewers onto the selected chain via the
// generalized recruiter (the third insertion point). The manifest
// chain is never shrunk; recruits append after it. mode 'off' is the caller
// override; a recruitment failure leaves the chain unchanged, advisory only.

function resolveProcedureRecruitment({ input, selectedWorkerProfiles, map, mode, warnings }) {
  if (mode === 'off') {
    return { recruited: [], addedWorkerProfiles: [], rationale: ['recruitment: off (caller override)'] };
  }
  try {
    const signals = requestSignals(String(input || ''));
    const recruited = recruit({
      signals,
      kind: 'review',
      exclude: selectedWorkerProfiles,
    });
    const addedWorkerProfiles = [];
    const rationale = [];
    for (const p of recruited) {
      const workerProfileId = p.workerProfileId || p.workerProfile;
      if (!workerProfileId) continue;
      if (selectedWorkerProfiles.includes(workerProfileId) || addedWorkerProfiles.includes(workerProfileId)) continue;
      if (!map.has(workerProfileId)) {
        warnings.push(`recruitment: unknown Worker Profile skipped: ${workerProfileId}.`);
        continue;
      }
      addedWorkerProfiles.push(workerProfileId);
      rationale.push(`${workerProfileId} recruited for ${p.assignmentRole || p.role || 'review'} (${p.gate}): ${p.reason}`);
    }
    return { recruited, addedWorkerProfiles, rationale };
  } catch (err) {
    warnings.push(`recruitment: evaluation failed (${err.message}); manifest chain unchanged.`);
    return { recruited: [], addedWorkerProfiles: [], rationale: [] };
  }
}

function errorResult({ procedureRunId, traceId, approvalMode, code, message, warnings }) {
  return {
    procedureRunId,
    status: 'error',
    selectedWorkerProfiles: [],
    workerProfileStrategy: null,
    workerProfileRationale: [],
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
 * Invoke an embedded Procedure. Async because durable provenance and approval
 * records are written through existing stores. Returns a result object carrying
 * a `warnings` array (lifted into the envelope by the calling surface).
 *
 * @param {object} request
 * @param {string} request.procedureId
 * @param {string} [request.input]
 * @param {object} [request.context]
 * @param {string} [request.workerProfileStrategy]    auto | explicit | constrained
 * @param {string[]} [request.requestedWorkerProfiles]
 * @param {string} [request.recruitment] auto (default) | off — signal-driven recruits append to the selected chain
 * @param {string} [request.approvalMode]     proposal-only | requires-human-approval | allow-durable-write
 * @param {boolean} [request.trace=true]
 * @param {string} [request.host]
 * @param {string} [request.hostModel]
 * @param {string} [request.hostProvider]
 * @param {string} [request.constructStrategy]  orchestrated | prompt-only | auto (execution mode)
 * @param {object} [opts]   { env, cwd }
 * @returns {Promise<object>}
 */
export async function invokeProcedure(request = {}, { env = process.env, cwd = process.cwd() } = {}) {
  const {
    procedureId, context = {}, workerProfileStrategy = 'auto', requestedWorkerProfiles,
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
  const procedureRunId = `procedure-${randomUUID()}`;

  const def = getProcedureDefinition(procedureId);
  if (!def) {
    return errorResult({ procedureRunId, traceId, approvalMode, code: 'UNKNOWN_PROCEDURE', message: `Unknown Procedure "${procedureId}". Known: ${PROCEDURE_IDS.join(', ')}.`, warnings });
  }

  const strategy = VALID_STRATEGIES.includes(workerProfileStrategy) ? workerProfileStrategy : 'auto';
  if (strategy !== workerProfileStrategy) warnings.push(`Unknown workerProfileStrategy "${workerProfileStrategy}"; defaulting to auto.`);

  const map = workerProfileMap();
  const selectedWorkerProfiles = selectWorkerProfiles({ strategy, defaults: def.workerProfiles, requestedWorkerProfiles, map, warnings });
  if (selectedWorkerProfiles.length === 0) {
    return errorResult({ procedureRunId, traceId, approvalMode, code: 'NO_WORKER_PROFILES_SELECTED', message: 'Worker Profile selection produced an empty Assignment sequence.', warnings });
  }

  const recruitment = resolveProcedureRecruitment({
    input: request.input,
    selectedWorkerProfiles,
    map,
    mode: request.recruitment,
    warnings,
  });
  selectedWorkerProfiles.push(...recruitment.addedWorkerProfiles);

  const { warnings: modelWarnings = [], ...modelResolution } = resolveEmbeddedModel(
    { workflowType: procedureId, requestedTier: def.modelTier, host, hostModel, hostProvider },
    { env },
  );
  for (const w of modelWarnings) warnings.push(`model-resolution: ${w}`);

  // The execution-capability contract reports the PLANNED executionMode for this
  // run (descriptive, not enforced). Construct returns a plan; the
  // host runtime executes it, so this never claims observed specialist execution.
  const executionData = resolveExecution(
    { procedureId, requestedStrategy: constructStrategy, host, hostModel, hostProvider, requestedTier: def.modelTier },
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

  const primaryOwner = selectedWorkerProfiles[0];
  const facts = contractFacts(primaryOwner);
  const skillsApplied = skillsForWorkerProfiles(selectedWorkerProfiles, map);
  const rationale = workerProfileRationale(selectedWorkerProfiles, map);

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
  const mode = approvalMode || def.approvalMode;
  const gate = resolveWriteGate({ approvalMode: mode, deploymentMode });

  // requiredOutputFields carries the framework's `emits` tokens IN STEP ORDER
  // the host runtime must return one labeled output per token,
  // in that order, so the reasoning procedure is checkable, not just prose.

  const outputs = {
    schema: def.outputSchema,
    expected: facts.expectedOutputs,
    requiredOutputFields: framework.available ? framework.requiredOutputFields : [],
    note: 'Construct returns the orchestration plan and output contract; specialist reasoning is performed by the host agent runtime.',
  };
  const recommendations = [`Assign Worker Profiles in order: ${selectedWorkerProfiles.join(' → ')}.`];
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
      await recordApprovalNotice({
        workerProfileId: primaryOwner,
        action: `procedure:${procedureId}`,
        target: procedureRunId,
        reason: `Procedure ${procedureId} awaiting human approval.`,
        context: { procedureId, selectedWorkerProfiles, traceId },
      });
    } catch (err) {
      warnings.push(`Could not record approval request: ${err.message}`);
    }
    status = 'awaiting-approval';
  } else if (gate.allowWrites) {
    try {
      // The durable trace must carry the recruited set WITH its reasons
      // (cross-surface parity) — roles= alone shows who was
      // added but a later audit could not tell why without re-deriving signals.
      const recruitmentLine = recruitment.addedWorkerProfiles.length
        ? `; recruited=${recruitment.addedWorkerProfiles.join(',')}; recruitmentRationale=${recruitment.rationale.join(' | ')}`
        : '';
      const obs = await addObservation(cwd, {
        role: primaryOwner,
        category: 'decision',
        summary: `Procedure invoked: ${procedureId}`,
        content: `workerProfiles=${selectedWorkerProfiles.join(',')}; modelTier=${def.modelTier}; model=${modelResolution.selectedModel || 'unresolved'}; traceId=${traceId}${recruitmentLine}`,
        tags: ['embedded-contract', `procedure/${procedureId}`],
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

  // Trace provenance (alignment): a downstream audit reads
  // {frameworkId, frameworkVersion, frameworkSource} off the trace to know
  // which reasoning procedure (if any) governed this run, the same way F1
  // already records {workerProfileId, packId, promptVersion} for the Worker Profile
  // that ran. traceId itself is already carried (and correlated) at the top
  // level, so it is not duplicated here.

  const traceProvenance = {
    role: primaryOwner,
    frameworkId: framework.available ? framework.frameworkId : null,
    frameworkVersion: framework.available ? framework.version : null,
    frameworkSource: framework.available ? framework.source : null,
    degraded: framework.available ? null : framework.degraded,
  };

  return withInvokePlanLifecycle({
    procedureRunId,
    procedureId,
    status,
    ingestion,
    selectedWorkerProfiles,
    workerProfileStrategy: strategy,
    workerProfileRationale: rationale,
    recruitment: {
      recruited: recruitment.recruited,
      addedWorkerProfiles: recruitment.addedWorkerProfiles,
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
  });
}
