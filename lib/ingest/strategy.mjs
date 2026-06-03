/**
 * lib/ingest/strategy.mjs — resolve the ingest extraction strategy and provider model.
 *
 * Construct's ingest path historically extracted documents through local binary
 * adapters (docling/whisper/pdftotext) without surfacing that choice. This module
 * makes the choice explicit and configurable:
 *   - `adapter` (default): the local-extractor pipeline, byte-for-byte unchanged.
 *   - `provider`: route document understanding through the configured provider/model.
 * A `fallback` policy (`none`/`provider`/`adapter`) governs what happens on
 * primary-path failure; the default `none` never silently masks a strategy
 * mismatch. Resolution precedence matches the project-config convention:
 * env > config > default. Provider/model identification reuses the embedded model
 * resolution contract and the tier registry so no second selection surface exists.
 */

import { resolveSetting } from '../config/project-config.mjs';
import { resolveEmbeddedModel } from '../embedded-contract/model-resolve.mjs';

export const INGEST_STRATEGIES = ['adapter', 'provider'];
export const INGEST_FALLBACKS = ['none', 'provider', 'adapter'];

export const DEFAULT_INGEST_STRATEGY = 'adapter';
export const DEFAULT_INGEST_FALLBACK = 'none';

function coerceEnum(value, allowed) {
  if (typeof value !== 'string') return null;
  const lowered = value.trim().toLowerCase();
  return allowed.includes(lowered) ? lowered : null;
}

// The strategy step a document-understanding model serves under is `fast`; ingest
// is an extraction/understanding pass, not a reasoning workflow. The embedded
// resolution contract maps this tier to a concrete provider/model.

const INGEST_WORKFLOW_TYPE = 'evidence-ingest';

function resolveProviderModel({ env, registryPath }) {
  const resolved = resolveEmbeddedModel({ workflowType: INGEST_WORKFLOW_TYPE }, { env, registryPath });
  return {
    model: resolved.selectedModel || null,
    provider: resolved.selectedProvider || null,
    resolutionSource: resolved.resolutionSource || null,
    error: resolved.error || null,
  };
}

/**
 * Resolve the effective ingest strategy, fallback policy, and provider model.
 *
 * Precedence for both strategy and fallback is env > config > explicit override
 * > default, where an explicit `override` (a CLI flag) wins over env/config when
 * provided. The returned `model`/`provider` are non-null only when the resolved
 * strategy is `provider` or when `fallback` could route to a provider.
 *
 * @param {object} opts
 * @param {object} [opts.config]      loaded project config object
 * @param {Record<string,string>} [opts.env]
 * @param {string} [opts.override]    explicit strategy override (CLI flag)
 * @param {string} [opts.registryPath]
 * @returns {{strategy:string, fallback:string, model:(string|null), provider:(string|null), modelResolution:(object|null)}}
 */
export function resolveIngestStrategy({ config = null, env = process.env, override = null, registryPath = null } = {}) {
  const overrideStrategy = coerceEnum(override, INGEST_STRATEGIES);

  const fromSettings = resolveSetting({
    config,
    jsonPath: 'ingest.strategy',
    env,
    envKey: 'CONSTRUCT_INGEST_STRATEGY',
    defaultValue: DEFAULT_INGEST_STRATEGY,
  });
  const strategy = overrideStrategy
    || coerceEnum(fromSettings.value, INGEST_STRATEGIES)
    || DEFAULT_INGEST_STRATEGY;

  const fallbackSetting = resolveSetting({
    config,
    jsonPath: 'ingest.fallback',
    env,
    envKey: 'CONSTRUCT_INGEST_FALLBACK',
    defaultValue: DEFAULT_INGEST_FALLBACK,
  });
  const fallback = coerceEnum(fallbackSetting.value, INGEST_FALLBACKS) || DEFAULT_INGEST_FALLBACK;

  const needsProviderModel = strategy === 'provider' || fallback === 'provider';
  const modelResolution = needsProviderModel ? resolveProviderModel({ env, registryPath }) : null;

  return {
    strategy,
    fallback,
    model: modelResolution?.model || null,
    provider: modelResolution?.provider || null,
    modelResolution,
  };
}
