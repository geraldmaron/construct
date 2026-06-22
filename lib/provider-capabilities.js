/**
 * lib/provider-capabilities.js — Model-agnostic provider capability interface.
 *
 * Follows the embeddings-engine.js pattern:
 *   - This file is the model-agnostic router.
 *   - Provider-specific logic lives in provider-capabilities-*.js adapters.
 *   - All adapters return the same capability shape.
 *
 * Standard capability interface (all adapters implement this shape):
 *   - cacheControl: boolean
 *   - cacheMechanism: 'annotation' | 'automatic' | 'resource' | 'none'
 *   - cacheTTL: { '5m': number, '1h': number } | null (tokens, not ms)
 *   - structuredOutput: boolean
 *   - maxContextWindow: number (tokens)
 *   - tokenRatio: number (chars per token for this provider)
 *   - annotationFormat: 'anthropic' | 'google' | 'openai' | 'none'
 *   - annotationHeaders: object | null
 */
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const CAPABILITY_CACHE_PATH = join(homedir(), '.cx', 'provider-capabilities.json');
const CAPABILITY_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

const ADAPTERS = {
  anthropic: () => import('./provider-capabilities-anthropic.js'),
  'anthropic-direct': () => import('./provider-capabilities-anthropic.js'),
  google: () => import('./provider-capabilities-google.js'),
  openai: () => import('./provider-capabilities-openai.js'),
  deepseek: () => import('./provider-capabilities-deepseek.js'),
  generic: () => import('./provider-capabilities-generic.js'),
};

function resolveAdapterKey(modelId) {
  const id = String(modelId || '').toLowerCase();
  if (/^anthropic\//.test(id) || /^openrouter\/anthropic\//.test(id)) return 'anthropic';
  if (/^google\//.test(id) || /^openrouter\/google\//.test(id)) return 'google';
  if (/^openai\//.test(id) || /^openrouter\/openai\//.test(id) || /^github-copilot\//.test(id)) return 'openai';
  if (/^deepseek\//.test(id) || /^openrouter\/deepseek\//.test(id)) return 'deepseek';
  return 'generic';
}

// Declared adapter defaults for sync hot paths when the 24h probe cache is cold.
// Matches the static `capabilities()` exports in provider-capabilities-*.js.

const SYNC_ADAPTER_CAPS = {
  anthropic: {
    cacheControl: true,
    cacheMechanism: 'annotation',
    cacheTTL: { '5m': 300_000, '1h': 1_200_000 },
    structuredOutput: true,
    maxContextWindow: 200_000,
    tokenRatio: 3.5,
    annotationFormat: 'anthropic',
    annotationHeaders: { 'anthropic-version': '2024-10-22' },
  },
  google: {
    cacheControl: true,
    cacheMechanism: 'resource',
    cacheTTL: { '5m': null, '1h': 1_200_000 },
    structuredOutput: true,
    maxContextWindow: 1_000_000,
    tokenRatio: 4,
    annotationFormat: 'google',
    annotationHeaders: null,
  },
  openai: {
    cacheControl: false,
    cacheMechanism: 'automatic',
    cacheTTL: null,
    structuredOutput: true,
    maxContextWindow: 128_000,
    tokenRatio: 4,
    annotationFormat: 'openai',
    annotationHeaders: null,
  },
  deepseek: {
    cacheControl: false,
    cacheMechanism: 'none',
    cacheTTL: null,
    structuredOutput: true,
    maxContextWindow: 128_000,
    tokenRatio: 4,
    annotationFormat: 'none',
    annotationHeaders: null,
  },
  generic: {
    cacheControl: false,
    cacheMechanism: 'none',
    cacheTTL: null,
    structuredOutput: false,
    maxContextWindow: 200_000,
    tokenRatio: 4,
    annotationFormat: 'none',
    annotationHeaders: null,
  },
};

function readCapabilityCache() {
  try {
    if (!existsSync(CAPABILITY_CACHE_PATH)) return {};
    const cached = JSON.parse(readFileSync(CAPABILITY_CACHE_PATH, 'utf8'));
    if (cached?.fetchedAt && Date.now() - cached.fetchedAt < CAPABILITY_CACHE_TTL_MS) {
      return cached.capabilities || {};
    }
  } catch { /* stale or corrupt */ }
  return {};
}

function writeCapabilityCache(capabilities) {
  try {
    mkdirSync(join(homedir(), '.cx'), { recursive: true });
    writeFileSync(CAPABILITY_CACHE_PATH, JSON.stringify({
      fetchedAt: Date.now(),
      capabilities,
    }, null, 2));
  } catch { /* best effort */ }
}

let _cache = null;
function getCache() {
  if (_cache === null) _cache = readCapabilityCache();
  return _cache;
}

/**
 * Resolve provider capabilities for a given model ID.
 * Returns the standard capability interface.
 *
 * @param {string} modelId - The model identifier (e.g., "anthropic/claude-opus-4-6")
 * @returns {object} Capability object with the standard shape
 */
export async function resolveProviderCapabilities(modelId) {
  const adapterKey = resolveAdapterKey(modelId);
  const loader = ADAPTERS[adapterKey] || ADAPTERS.generic;

  try {
    const { capabilities } = await loader();
    return capabilities(modelId);
  } catch {
    // Fallback to generic
    const { capabilities } = await ADAPTERS.generic();
    return capabilities(modelId);
  }
}

/**
 * Synchronous version — uses cache if available, otherwise returns generic.
 * Use this in hot paths where async is not possible.
 *
 * @param {string} modelId
 * @returns {object} Capability object
 */
export function resolveProviderCapabilitiesSync(modelId) {
  const adapterKey = resolveAdapterKey(modelId);
  const cache = getCache();

  // Check cache first (keyed by adapter type, not full model ID)
  if (cache[adapterKey]) return cache[adapterKey];

  return SYNC_ADAPTER_CAPS[adapterKey] || SYNC_ADAPTER_CAPS.generic;
}

/**
 * Probe provider for capabilities and cache the result for 24h.
 *
 * Static path (probe=false): resolves capabilities from the adapter's static
 * declaration. Live path (probe=true): dispatches to the adapter's optional
 * `probe(modelId)` export — adapters that don't implement it fall back to the
 * static declaration. Construct itself stays provider-agnostic; per-vendor
 * probing is the adapter's responsibility.
 *
 * @param {string} modelId
 * @param {object} opts - { probe: boolean }
 * @returns {Promise<object>}
 */
export async function probeProviderCapabilities(modelId, { probe = false } = {}) {
  const adapterKey = resolveAdapterKey(modelId);
  const loader = ADAPTERS[adapterKey] || ADAPTERS.generic;

  let caps;
  if (probe) {
    try {
      const mod = await loader();
      caps = typeof mod.probe === 'function'
        ? await mod.probe(modelId)
        : mod.capabilities(modelId);
    } catch {
      caps = await resolveProviderCapabilities(modelId);
    }
  } else {
    caps = await resolveProviderCapabilities(modelId);
  }

  const cache = getCache();
  cache[adapterKey] = caps;
  writeCapabilityCache(cache);

  return caps;
}
