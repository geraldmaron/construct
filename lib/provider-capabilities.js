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

  // Return generic synchronously (can't load adapter in sync context)
  return {
    cacheControl: false,
    cacheMechanism: 'none',
    cacheTTL: null,
    structuredOutput: false,
    maxContextWindow: 200000,
    tokenRatio: 4,
    annotationFormat: 'none',
    annotationHeaders: null,
  };
}

/**
 * Probe provider for live capabilities (async).
 * Results are cached for 24h.
 *
 * @param {string} modelId
 * @param {object} opts - { probe: boolean }
 * @returns {Promise<object>}
 */
export async function probeProviderCapabilities(modelId, { probe = false } = {}) {
  const caps = await resolveProviderCapabilities(modelId);

  if (probe) {
    // TODO: implement live probing (API call) in Phase A follow-up
    // For now, just return the static capabilities
  }

  // Cache by adapter key
  const adapterKey = resolveAdapterKey(modelId);
  const cache = getCache();
  cache[adapterKey] = caps;
  writeCapabilityCache(cache);

  return caps;
}
