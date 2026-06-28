/**
 * lib/models/execution-capability-profile.mjs — the single resolved capability
 * record (construct-6zga.1.8).
 *
 * Consolidates the four formerly-scattered capability producers into one
 * serializable, versioned record that model routing (resolveCapabilityTier) and specialist
 * prompt composition (resolveModelOperatingProfile via lib/prompt-composer.js) both
 * consume. It is keyed by provider, requested/resolved model, adapter protocol, and
 * observation time. Every capability declares an evidence source
 * (provider_metadata | live_probe | operator_override | compatibility_fallback |
 * unknown) and a confidence, so a reader can tell measured truth from a name/size
 * guess. Unknowns compile to conservative defaults and set a degraded flag for
 * telemetry.
 *
 * Provenance, not behavior change: this bead unifies the source of truth and
 * exposes measured evidence (provider metadata, the Ollama agentic-coherence
 * probe). The derived capabilityTier / operatingProfile still equal the existing
 * name/size heuristics (tagged compatibility_fallback) so live behavior is
 * preserved; construct-6zga.1.2 (capability-adaptive policy) is where measured
 * evidence will supersede the heuristic. Compatibility heuristics stay isolated in
 * model-router's resolveCapabilityTier / resolveModelOperatingProfile and are
 * documented there as the temporary fallback.
 *
 * Reference shape: schemas/execution-capability-profile.schema.json.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

import { resolveProviderCapabilitiesSync } from '../provider-capabilities.js';
import { getModelVerdict } from '../ollama/capability-store.mjs';
import { isLocalModel } from '../mcp/tool-budget.mjs';
import { transportForProviderGroup, classifyCapabilityClass } from './behavior-matrix.mjs';
import { resolveCapabilityTier, resolveModelOperatingProfile } from '../model-router.mjs';
import { doctorRoot } from '../config/xdg.mjs';

export const EXECUTION_PROFILE_SCHEMA_VERSION = 1;

export const PROFILE_EVIDENCE_SOURCES = Object.freeze([
  'provider_metadata',
  'live_probe',
  'operator_override',
  'compatibility_fallback',
  'unknown',
]);

const CONFIDENCE_LEVELS = Object.freeze(['high', 'medium', 'low', 'none']);

const OVERRIDES_FILENAME = 'capability-overrides.json';

function field(value, source, confidence) {
  return Object.freeze({ value, source, confidence });
}

export function providerGroupForModel(model) {
  const seg = String(model || '').split('/')[0];
  return seg || 'unknown';
}

// Adapter protocol mirrors provider worker dispatch:
// Anthropic uses its native messages API, OpenAI and Copilot use completions,
// and every other provider goes through the OpenAI-compatible shim.

function adapterProtocolForGroup(group) {
  if (group === 'anthropic') return 'anthropic-messages';
  if (group === 'openai' || group === 'github-copilot') return 'openai-chat-completions';
  return 'openai-compatible';
}

// Mirrors resolveAdapterKey in lib/provider-capabilities.js: a model that maps to a
// vendor adapter carries that vendor's declared metadata; anything else falls to the
// generic default, which is a guess, not provider metadata.

function hasVendorAdapter(modelId) {
  const id = String(modelId || '').toLowerCase();
  if (/^anthropic\//.test(id) || /^openrouter\/anthropic\//.test(id)) return true;
  if (/^google\//.test(id) || /^openrouter\/google\//.test(id)) return true;
  if (/^openai\//.test(id) || /^openrouter\/openai\//.test(id) || /^github-copilot\//.test(id)) return true;
  if (/^deepseek\//.test(id) || /^openrouter\/deepseek\//.test(id)) return true;
  return false;
}

function loadOverridesFile(homeDir) {
  try {
    const raw = JSON.parse(readFileSync(join(doctorRoot(homeDir), OVERRIDES_FILENAME), 'utf8'));
    if (raw && typeof raw === 'object' && raw.models && typeof raw.models === 'object') return raw.models;
  } catch { /* absent or malformed — no overrides */ }
  return {};
}

// The Ollama agentic-coherence store is keyed by the native model id (no ollama/
// prefix), the same transform bin/construct uses before isKnownCollapsed.

function localVerdict(model) {
  if (!isLocalModel(model)) return null;
  const native = String(model).replace(/^ollama\//, '');
  return getModelVerdict(native);
}

/**
 * Resolve the execution capability profile for a model. Synchronous and
 * side-effect free: it reads cached/declared evidence only — live probing is the
 * opt-in job of lib/models/behavior-matrix.mjs, never this resolver.
 */
export function resolveExecutionCapabilityProfile({
  model,
  resolvedModel = null,
  envValues = {},
  overrides = null,
  homeDir = homedir(),
  now = () => new Date().toISOString(),
} = {}) {
  const requestedModel = model || null;
  const group = providerGroupForModel(model);
  const transport = transportForProviderGroup(group);
  const overrideMap = (overrides ?? loadOverridesFile(homeDir))[requestedModel] || {};

  const vendor = hasVendorAdapter(model);
  const providerCaps = resolveProviderCapabilitiesSync(model);
  const capsSource = vendor ? 'provider_metadata' : 'compatibility_fallback';
  const capsConfidence = vendor ? 'medium' : 'low';

  const verdict = localVerdict(model);
  const coherent = verdict ? verdict.coherent === true : null;

  const measured = {
    toolsKnown: verdict ? verdict.calledTool === true : false,
    tools: verdict ? verdict.calledTool === true : false,
    coherent,
  };
  const capabilityClass = classifyCapabilityClass({ transport, measured });

  const tierFallback = resolveCapabilityTier({ model });
  const operatingProfileFallback = resolveModelOperatingProfile({ envValues, selectedModel: model });

  const apply = (key, fallbackField) => {
    if (Object.prototype.hasOwnProperty.call(overrideMap, key)) {
      return field(overrideMap[key], 'operator_override', 'high');
    }
    return fallbackField;
  };

  const capabilities = {
    contextWindow: apply('contextWindow', field(providerCaps.maxContextWindow ?? null, capsSource, capsConfidence)),
    structuredOutput: apply('structuredOutput', field(providerCaps.structuredOutput === true, capsSource, capsConfidence)),
    cacheControl: apply('cacheControl', field(providerCaps.cacheControl === true, capsSource, capsConfidence)),
    tokenRatio: apply('tokenRatio', field(providerCaps.tokenRatio ?? null, capsSource, capsConfidence)),
    agenticCoherence: apply('agenticCoherence', verdict
      ? field(verdict.coherent ? 'COHERENT' : 'COLLAPSED', 'live_probe', 'medium')
      : field(null, 'unknown', 'none')),
    capabilityTier: apply('capabilityTier', field(tierFallback, 'compatibility_fallback', 'low')),
    operatingProfileId: apply('operatingProfileId', field(operatingProfileFallback.id, 'compatibility_fallback', 'low')),
  };

  const evidenceSources = [...new Set(Object.values(capabilities).map((f) => f.source))];
  const hasMeasured = evidenceSources.some((s) => s === 'provider_metadata' || s === 'live_probe' || s === 'operator_override');
  const degraded = capabilityClass === 'unknown' || !hasMeasured;

  return Object.freeze({
    schemaVersion: EXECUTION_PROFILE_SCHEMA_VERSION,
    key: Object.freeze({
      provider: group,
      requestedModel,
      resolvedModel: resolvedModel || requestedModel,
      adapterProtocol: adapterProtocolForGroup(group),
      observedAt: now(),
    }),
    capabilityClass,
    transport,
    capabilities: Object.freeze(capabilities),
    degraded,
    evidenceSources: Object.freeze(evidenceSources),
  });
}

export function capabilityTierFromProfile(profile) {
  return profile?.capabilities?.capabilityTier?.value ?? 'full';
}

export function operatingProfileIdFromProfile(profile) {
  return profile?.capabilities?.operatingProfileId?.value ?? 'balanced';
}

export function validateExecutionCapabilityProfile(profile) {
  const errors = [];
  if (!profile || typeof profile !== 'object') return { valid: false, errors: ['profile is not an object'] };
  if (profile.schemaVersion !== EXECUTION_PROFILE_SCHEMA_VERSION) errors.push(`schemaVersion must be ${EXECUTION_PROFILE_SCHEMA_VERSION}`);
  if (!profile.key || typeof profile.key !== 'object') errors.push('key missing');
  if (typeof profile.degraded !== 'boolean') errors.push('degraded must be boolean');
  if (!Array.isArray(profile.evidenceSources)) errors.push('evidenceSources must be an array');
  for (const [name, f] of Object.entries(profile.capabilities || {})) {
    if (!f || typeof f !== 'object') { errors.push(`capabilities.${name} not a field`); continue; }
    if (!PROFILE_EVIDENCE_SOURCES.includes(f.source)) errors.push(`capabilities.${name}.source invalid: ${f.source}`);
    if (!CONFIDENCE_LEVELS.includes(f.confidence)) errors.push(`capabilities.${name}.confidence invalid: ${f.confidence}`);
  }
  return { valid: errors.length === 0, errors };
}
