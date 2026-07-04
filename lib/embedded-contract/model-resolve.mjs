/**
 * lib/embedded-contract/model-resolve.mjs — embedded model resolution contract.
 *
 * Given a host/IDE's provider context, resolve which model an embedded Construct
 * workflow should use, following a fixed precedence:
 *   1. host-model           — the host's model, when recognized
 *   2. same-family-fallback — a tier model in the host model's provider family
 *   3. tier-default         — Construct's configured tier default (env/config/registry)
 *   4. config error         — structured error with remediation when nothing resolves
 *
 * Cross-provider fallback is only taken when the caller opts in; otherwise host
 * context that cannot be honored within its family yields a config error rather
 * than silently switching providers. The contract never reads or returns a
 * credential value — `requiresCredential` is a derived boolean — and never
 * claims provider health it cannot verify (`healthStatus` defaults to unknown).
 */

import { defaultModelRegistryPath, describeModelFamily, listModelFamilies } from '../model-router.mjs';
import { resolveModelTiers } from '../model-registry.mjs';
import { resolveProviderCapabilitiesSync } from '../provider-capabilities.js';

const VALID_TIERS = ['reasoning', 'standard', 'fast'];
const DEFAULT_TIER = 'standard';

// Workflow types lean toward deeper reasoning or faster turnaround; this maps a
// workflowType to a tier only when the caller did not request one explicitly.

const WORKFLOW_TIER_HINTS = {
  'architecture-review': 'reasoning',
  'risk-review': 'reasoning',
  'research-synthesis': 'reasoning',
  'prd-draft': 'standard',
  'proposal-review': 'standard',
  'evidence-ingest': 'fast',
};

function normalizeTier(tier) {
  return VALID_TIERS.includes(tier) ? tier : null;
}

function resolveTier({ requestedTier, workflowType }) {
  return normalizeTier(requestedTier) || WORKFLOW_TIER_HINTS[workflowType] || DEFAULT_TIER;
}

// Capability matching is best-effort against the model's known capability flags;
// names that cannot be confirmed are surfaced as warnings rather than asserted.

function matchCapabilities(modelId, requested, warnings) {
  if (!Array.isArray(requested) || requested.length === 0) return [];
  const caps = resolveProviderCapabilitiesSync(modelId);
  const matched = [];
  const unverified = [];
  for (const name of requested) {
    const key = String(name);
    if (caps[key] === true) matched.push(key);
    else unverified.push(key);
  }
  if (unverified.length) {
    warnings.push(`Capability not confirmed for ${modelId}: ${unverified.join(', ')} (capability verification is best-effort).`);
  }
  return matched;
}

function familyByProvider(hostProvider, env, allowAmbient) {
  if (!hostProvider || typeof hostProvider !== 'string') return null;
  const families = listModelFamilies({ env, allowAmbient });
  return families.find((f) => f.id === hostProvider)
    || families.find((f) => f.id === `openrouter-${hostProvider}`)
    || null;
}

function success({ selectedModel, family, tier, resolutionSource, fallbackReason = null, tierSource = null, capabilities, warnings, env, allowAmbient }) {
  return {
    selectedModel,
    selectedProvider: family ? family.id : null,
    providerFamily: family ? family.id : null,
    resolutionSource,
    requestedTier: tier,
    fallbackReason,
    tierSource,
    capabilitiesMatched: matchCapabilities(selectedModel, capabilities, warnings),
    healthStatus: 'unknown',
    estimatedLimits: null,
    requiresCredential: family ? !family.local && !family.configured : true,
    error: null,
    warnings,
  };
}

function configError({ tier, reason, remediation, warnings }) {
  return {
    selectedModel: null,
    selectedProvider: null,
    providerFamily: null,
    resolutionSource: 'config-error',
    requestedTier: tier,
    fallbackReason: null,
    tierSource: null,
    capabilitiesMatched: [],
    healthStatus: 'unknown',
    estimatedLimits: null,
    requiresCredential: null,
    error: { code: 'MODEL_UNRESOLVED', reason, remediation },
    warnings,
  };
}

/**
 * Resolve the model an embedded workflow should use. Pure and synchronous;
 * returns a result object carrying a `warnings` array (lifted into the envelope
 * by the calling surface).
 *
 * @param {object} request
 * @param {string} [request.workflowType]
 * @param {string} [request.requestedTier]      reasoning | standard | fast
 * @param {string} [request.host]
 * @param {string} [request.hostModel]
 * @param {string} [request.hostProvider]
 * @param {string[]} [request.capabilities]
 * @param {boolean} [request.allowCrossProviderFallback=false]
 * @param {object} [opts]
 * @param {Record<string,string>} [opts.env]
 * @param {string} [opts.registryPath]
 * @returns {object}
 */
export function resolveEmbeddedModel(request = {}, { env = process.env, registryPath = null, allowAmbient = env === process.env } = {}) {
  const { workflowType, requestedTier, hostModel, hostProvider, capabilities, allowCrossProviderFallback = false } = request;
  const tier = resolveTier({ requestedTier, workflowType });
  const warnings = [];

  const hostFamily = hostModel ? describeModelFamily(hostModel, { env, allowAmbient }) : null;

  if (hostModel && hostFamily) {
    return success({ selectedModel: hostModel, family: hostFamily, tier, resolutionSource: 'host-model', capabilities, warnings, env, allowAmbient });
  }
  if (hostModel && !hostFamily) {
    warnings.push(`Host model "${hostModel}" is not a recognized provider family; attempting same-family or tier fallback.`);
  }

  const family = hostFamily || familyByProvider(hostProvider, env, allowAmbient);
  if (family) {
    const model = family.tiers[tier];
    if (model) {
      const fallbackReason = hostModel
        ? `Exact host model unavailable; resolved the ${tier} model in the same provider family (${family.id}).`
        : `Resolved the ${tier} model within the host provider family (${family.id}).`;
      return success({ selectedModel: model, family, tier, resolutionSource: 'same-family-fallback', fallbackReason, capabilities, warnings, env, allowAmbient });
    }
  }

  const hadHostContext = Boolean(hostModel || hostProvider);
  if (hadHostContext && !allowCrossProviderFallback) {
    return configError({
      tier,
      reason: 'Host model/provider could not be honored within its family and cross-provider fallback is disabled.',
      remediation: 'Pass allowCrossProviderFallback=true, supply a recognized hostModel, or configure a same-family credential.',
      warnings,
    });
  }

  const tiers = resolveModelTiers({ env, registryPath: registryPath ?? defaultModelRegistryPath(env) });
  const defaultModel = tiers.models[tier];
  if (defaultModel) {
    const fallbackReason = hadHostContext
      ? 'Host context could not be honored within its family; used the Construct tier default after cross-provider fallback was permitted.'
      : 'No host context supplied; used the Construct tier default.';
    return success({
      selectedModel: defaultModel,
      family: describeModelFamily(defaultModel, { env, allowAmbient }),
      tier,
      resolutionSource: 'tier-default',
      fallbackReason,
      tierSource: tiers.sources[tier] || 'default',
      capabilities,
      warnings,
      env,
      allowAmbient,
    });
  }

  return configError({
    tier,
    reason: `No model could be resolved for the ${tier} tier.`,
    remediation: 'Set CX_MODEL_REASONING/STANDARD/FAST or configure a provider credential.',
    warnings,
  });
}
