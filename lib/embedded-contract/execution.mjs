/**
 * lib/embedded-contract/execution.mjs — embedded execution-capability contract.
 *
 * An embedded host can request Construct orchestration but cannot otherwise tell
 * whether a run actually engaged Worker Profiles/Skills/Assignments or degraded to a
 * prompt-only envelope — and if it degraded, why. This contract answers that
 * before or at workflow start: given a requested strategy and the host's model
 * context, it derives an `executionMode`, the Construct capabilities that mode
 * contributes, and an explicit degradation reason.
 *
 * Honesty boundary: orchestration in the embedded layer is
 * DESCRIPTIVE, not enforced. Construct returns a plan; the host runtime performs
 * the reasoning. So this contract reports what Construct PLANNED and can RESOLVE
 * a model for — never an observation that the host executed personas. Every
 * response carries a `semantics` disclaimer to that effect, and
 * `constructCapabilitiesActive` describes Construct's contribution, not proof of
 * host execution. Claiming observed orchestration would violate the
 * no-fabrication rule. A `same-family-fallback` (host model unavailable) and a
 * `config-error` (no model) both surface as `degraded: true`.
 *
 * Pure and synchronous; reuses resolveEmbeddedModel (no second model surface)
 * and returns a result object carrying `warnings`, lifted into the envelope by
 * the calling surface.
 */

import { getDeploymentMode } from '../deployment-mode.mjs';
import { resolveEmbeddedModel } from './model-resolve.mjs';
import { getProcedureDefinition } from './procedure-definitions.mjs';

export const EXECUTION_MODES = ['construct-orchestrated', 'construct-prompt-only', 'host-direct', 'same-family-fallback'];
export const CONSTRUCT_STRATEGIES = ['orchestrated', 'prompt-only', 'auto'];
export const CONSTRUCT_CAPABILITIES = ['worker-profiles', 'skills', 'workflow-routing', 'prompt-envelope'];

export const EXECUTION_SEMANTICS = 'Reports Construct-planned capability and model-resolvability before/at Procedure start; does not observe host execution. constructCapabilitiesActive describes what Construct contributes, not proof the host ran Worker Profiles or Skills.';

const ORCHESTRATED_CAPS = ['worker-profiles', 'skills', 'workflow-routing', 'prompt-envelope'];
const PROMPT_ONLY_CAPS = ['prompt-envelope'];

function normalizeStrategy(value) {
  const lowered = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return CONSTRUCT_STRATEGIES.includes(lowered) ? lowered : null;
}

/**
 * Resolve the execution-capability contract for an embedded workflow.
 *
 * @param {object} request
 * @param {string} [request.workflowType]        workflow whose orchestration plan is being weighed
 * @param {string} [request.requestedStrategy]   orchestrated | prompt-only | auto (default auto)
 * @param {boolean} [request.useConstruct=true]  false ⇒ host-direct (host runs without Construct)
 * @param {string} [request.host]
 * @param {string} [request.hostModel]
 * @param {string} [request.hostProvider]
 * @param {string} [request.requestedTier]
 * @param {string[]} [request.capabilities]
 * @param {boolean} [request.allowCrossProviderFallback=false]
 * @param {object} [opts]
 * @param {Record<string,string>} [opts.env]
 * @param {string} [opts.cwd]
 * @param {string} [opts.registryPath]
 * @returns {object}
 */
export function resolveExecution(request = {}, { env = process.env, cwd = process.cwd(), registryPath = null } = {}) {
  const {
    procedureId = null,
    requestedStrategy: rawStrategy,
    useConstruct = true,
    host, hostModel, hostProvider, requestedTier, capabilities, allowCrossProviderFallback = false,
  } = request;

  const warnings = [];
  const requestedStrategy = normalizeStrategy(rawStrategy) || 'auto';
  if (rawStrategy != null && !normalizeStrategy(rawStrategy)) {
    warnings.push(`Unknown requestedStrategy "${rawStrategy}"; defaulted to "auto".`);
  }

  const deploymentMode = getDeploymentMode(env, { cwd });

  // Model resolution is the single source of provider/model truth; its warnings
  // are namespaced so an embedder can tell model concerns from execution ones.
  const modelResolution = resolveEmbeddedModel(
    { workflowType: procedureId, requestedTier, host, hostModel, hostProvider, capabilities, allowCrossProviderFallback },
    { env, registryPath },
  );
  for (const w of modelResolution.warnings || []) warnings.push(`model-resolution: ${w}`);

  const { resolutionSource, selectedModel, selectedProvider } = modelResolution;
  const orchestrationAvailable = resolutionSource !== 'config-error';

  // An explicit-but-unknown workflowType has no plan; absent a workflowType,
  // Construct's generic router can still orchestrate, so a plan is available.
  const knownProcedure = procedureId ? Boolean(getProcedureDefinition(procedureId)) : true;
  if (procedureId && !knownProcedure) {
    warnings.push(`Unknown Procedure "${procedureId}"; no orchestration plan is available for it.`);
  }
  const orchestrationPlanned = knownProcedure;

  const base = {
    requestedStrategy,
    selectedProvider,
    selectedModel,
    resolutionSource,
    orchestrationPlanned,
    orchestrationAvailable,
    deploymentMode,
    modelResolution: stripWarnings(modelResolution),
    semantics: EXECUTION_SEMANTICS,
    warnings,
  };

  if (useConstruct === false) {
    return {
      ...base,
      executionMode: 'host-direct',
      effectiveStrategy: 'host-direct',
      constructCapabilitiesActive: [],
      degraded: false,
      degradationReason: null,
    };
  }

  if (requestedStrategy === 'prompt-only') {
    return {
      ...base,
      executionMode: 'construct-prompt-only',
      effectiveStrategy: 'prompt-only',
      constructCapabilitiesActive: [...PROMPT_ONLY_CAPS],
      degraded: false,
      degradationReason: null,
    };
  }

  // orchestrated or auto: deliver orchestration only when a plan exists AND a
  // model resolves. A same-family fallback runs but did not honor the host's
  // exact model, so it is reported as its own mode and as degraded.
  const canOrchestrate = orchestrationPlanned && orchestrationAvailable;
  if (canOrchestrate) {
    if (resolutionSource === 'same-family-fallback') {
      return {
        ...base,
        executionMode: 'same-family-fallback',
        effectiveStrategy: 'orchestrated',
        constructCapabilitiesActive: [...ORCHESTRATED_CAPS],
        degraded: true,
        degradationReason: `Host model unavailable; resolved a same-family tier model — ${modelResolution.fallbackReason || 'same-family fallback applied'}.`,
      };
    }
    return {
      ...base,
      executionMode: 'construct-orchestrated',
      effectiveStrategy: 'orchestrated',
      constructCapabilitiesActive: [...ORCHESTRATED_CAPS],
      degraded: false,
      degradationReason: null,
    };
  }

  // Could not orchestrate. Degradation is asserted only when orchestration was
  // explicitly requested, or when no model resolved at all (auto still needs a
  // model to do anything useful).
  let degraded = false;
  let degradationReason = null;
  if (!orchestrationAvailable) {
    degraded = true;
    degradationReason = `Model could not be resolved; orchestration requires a runnable model — ${(modelResolution.error?.reason || 'no model available').replace(/\.$/, '')}.`;
  } else if (requestedStrategy === 'orchestrated') {
    degraded = true;
    degradationReason = `Orchestration was requested but no orchestration plan is available${procedureId ? ` for procedure "${procedureId}"` : ''}.`;
  }

  return {
    ...base,
    executionMode: 'construct-prompt-only',
    effectiveStrategy: 'prompt-only',
    constructCapabilitiesActive: [...PROMPT_ONLY_CAPS],
    degraded,
    degradationReason,
  };
}

function stripWarnings(result) {
  const { warnings, ...rest } = result || {};
  return rest;
}
