/**
 * lib/model-cheapest-provider.mjs — cheapest configured provider selection.
 *
 * Evaluates all configured providers, looks up their per-tier model pricing,
 * and returns the lowest-cost option. Local providers (Ollama, local) rank
 * first since they are $0.
 *
 * Pricing data comes from getPricingForModels() in model-pricing.mjs, which
 * has a 5-minute cache from the OpenRouter API. Static tables cover
 * Anthropic/OpenAI first-party models.
 *
 * Usage:
 *   selectCheapestProvider('standard')          // cheapest for one tier
 *   rankConfiguredProvidersByCost('fast')       // full ranked list
 *   isCheapestProviderEnabled()                 // check opt-in preference
 *   formatCheapestProviderMessage(result)       // user-facing output
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getProviderModelCatalog, PROVIDER_FAMILY_TIERS } from './model-router.mjs';
import { getPricingForModels, formatPricingLabel } from './model-pricing.mjs';

const CHEAPEST_PREF_KEY = 'CHEAPEST_PROVIDER_ENABLED';
const CHEAPEST_CHECKED_KEY = 'CHEAPEST_PROVIDER_CHECKED';
const ENV_PATH = path.join(os.homedir(), '.construct', 'config.env');

/**
 * Resolve the cheapest configured provider for a given tier.
 *
 * @param {string} tier - One of "reasoning", "standard", "fast"
 * @param {object} [opts]
 * @param {object} [opts.env] - Environment object (default: process.env)
 * @param {string} [opts.envPath] - Path to config.env (default: ~/.construct/config.env)
 * @param {Function} [opts.getPricingForModels] - Injectable pricing fetcher
 * @returns {Promise<{
 *   providerId: string|null,
 *   providerLabel: string|null,
 *   modelId: string|null,
 *   inputPrice: number|null,
 *   outputPrice: number|null,
 *   isLocal: boolean,
 *   configuredProviders: string[],
 *   rankedList: Array<{providerId, providerLabel, modelId, inputPrice, outputPrice, totalPer1M, isLocal}>
 * }>}
 */
export async function selectCheapestProvider(tier, opts = {}) {
  if (!['reasoning', 'standard', 'fast'].includes(tier)) {
    return { providerId: null, providerLabel: null, modelId: null, configuredProviders: [], rankedList: [] };
  }

  const env = opts.env || process.env;
  const catalog = getProviderModelCatalog({ env });
  const configured = catalog.providers.filter((p) => p.configured);

  if (configured.length === 0) {
    return {
      providerId: null, providerLabel: null, modelId: null,
      inputPrice: null, outputPrice: null, isLocal: false,
      configuredProviders: [], rankedList: [],
    };
  }

  // Collect tier-specific model IDs from all configured providers
  const modelIds = [];
  for (const p of configured) {
    const modelId = p.tiers[tier];
    if (modelId) modelIds.push(modelId);
  }

  const needsRemote = modelIds.filter((id) => /^openrouter\//.test(id));
  const hasRemote = needsRemote.length > 0;

  // Fetch pricing (uses 5-min cache internally)
  let pricingMap = {};
  if (hasRemote) {
    try {
      pricingMap = await getPricingForModels(modelIds, {
        getPricingForModels: opts.getPricingForModels,
      });
    } catch { /* pricing unavailable — fall back to nulls */ }
  }

  // Score each provider
  const scored = configured.map((p) => {
    const modelId = p.tiers[tier];
    const pricing = hasRemote ? pricingMap[modelId] : null;
    const inputPrice = pricing ? (Number(pricing.input) || 0) : 0;
    const outputPrice = pricing ? (Number(pricing.output) || 0) : 0;
    return {
      providerId: p.id,
      providerLabel: p.label,
      modelId,
      inputPrice,
      outputPrice,
      totalPer1M: inputPrice + outputPrice,
      isLocal: p.local === true,
    };
  });

  // Sort ascending by total cost (local/$0 first)
  scored.sort((a, b) => a.totalPer1M - b.totalPer1M);

  const cheapest = scored[0];
  return {
    providerId: cheapest.providerId,
    providerLabel: cheapest.providerLabel,
    modelId: cheapest.modelId,
    inputPrice: cheapest.inputPrice,
    outputPrice: cheapest.outputPrice,
    isLocal: cheapest.isLocal,
    configuredProviders: configured.map((p) => p.id),
    rankedList: scored,
  };
}

/**
 * Get all configured providers ranked by cost for a tier.
 *
 * @param {string} tier
 * @param {object} [opts]
 * @returns {Promise<Array<{providerId, providerLabel, modelId, inputPrice, outputPrice, totalPer1M, isLocal}>>}
 */
export async function rankConfiguredProvidersByCost(tier, opts = {}) {
  const result = await selectCheapestProvider(tier, opts);
  return result.rankedList;
}

/**
 * Check if the user has opted into cheapest-provider selection.
 *
 * @param {string} [envPath] - Path to config.env (default: ~/.construct/config.env)
 * @param {object} [opts.env] - Environment override
 * @returns {boolean}
 */
export function isCheapestProviderEnabled(envPath, opts = {}) {
  const pathToUse = envPath || ENV_PATH;
  const env = opts.env || process.env;

  // Check env var first
  if (env[CHEAPEST_PREF_KEY]) {
    return env[CHEAPEST_PREF_KEY].toLowerCase() === 'yes';
  }

  // Check config.env file
  try {
    const content = fs.readFileSync(pathToUse, 'utf8');
    const match = content.match(new RegExp(`^${CHEAPEST_PREF_KEY}=(.+)$`, 'm'));
    if (match) {
      return match[1].trim().toLowerCase() === 'yes';
    }
  } catch { /* file doesn't exist */ }

  return false;
}

/**
 * Persist the cheapest-provider opt-in preference.
 *
 * @param {string} envPath - Path to config.env
 * @param {boolean} enabled
 */
export function setCheapestProviderPreference(envPath, enabled) {
  const pathToUse = envPath || ENV_PATH;
  const existing = fs.existsSync(pathToUse) ? fs.readFileSync(pathToUse, 'utf8') : '';
  const lines = existing.split('\n');
  const keyLine = `${CHEAPEST_PREF_KEY}=${enabled ? 'yes' : 'no'}`;

  // Replace existing key or append
  const idx = lines.findIndex((l) => l.startsWith(`${CHEAPEST_PREF_KEY}=`));
  if (idx >= 0) {
    lines[idx] = keyLine;
  } else {
    lines.push(keyLine);
  }

  fs.mkdirSync(path.dirname(pathToUse), { recursive: true });
  fs.writeFileSync(pathToUse, lines.join('\n'));
}

/**
 * Format the cheapest provider selection into a user-facing message.
 *
 * @param {object} result - Output from selectCheapestProvider
 * @param {object} [opts]
 * @param {boolean} [opts.showRanking] - Include full ranked list
 * @returns {string}
 */
export function formatCheapestProviderMessage(result, opts = {}) {
  const { providerId, providerLabel, modelId, inputPrice, outputPrice, isLocal, rankedList } = result;

  if (!providerId) {
    return 'No configured providers found. Set API keys or install Ollama to enable model selection.';
  }

  const label = formatPricingLabel({ input: inputPrice, output: outputPrice, source: isLocal ? 'local' : 'openrouter' });
  let msg = `Cheapest provider for this tier:\n`;
  msg += `  Provider:  ${providerLabel}\n`;
  msg += `  Model:     ${modelId}\n`;
  msg += `  Pricing:   ${label}`;

  if (opts.showRanking && rankedList && rankedList.length > 0) {
    msg += `\n\nConfigured providers ranked by cost:\n`;
    for (let i = 0; i < rankedList.length; i++) {
      const r = rankedList[i];
      const rLabel = formatPricingLabel({
        input: r.inputPrice,
        output: r.outputPrice,
        source: r.isLocal ? 'local' : 'openrouter',
      });
      const marker = i === 0 ? '→' : ' ';
      msg += `  ${marker} ${r.providerLabel.padEnd(28)} ${r.modelId.padEnd(40)} ${rLabel}\n`;
    }
  }

  return msg;
}

/**
 * Get all tier-specific cheapest selections.
 *
 * @param {object} [opts]
 * @returns {Promise<{reasoning, standard, fast}>}
 */
export async function selectCheapestForAllTiers(opts = {}) {
  const reasoning = await selectCheapestProvider('reasoning', opts);
  const standard = await selectCheapestProvider('standard', opts);
  const fast = await selectCheapestProvider('fast', opts);
  return { reasoning, standard, fast };
}
