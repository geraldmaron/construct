/**
 * lib/model-pricing.mjs — best-effort live pricing for the model selector.
 *
 * OpenRouter exposes a free, unauthenticated `GET /api/v1/models` endpoint
 * with per-1M-token pricing for every model in its catalog. We hit it once
 * per process (with a 5-minute cache to ~/.cx/model-pricing.json) and fall
 * back to a built-in pricing table for first-party endpoints (Anthropic,
 * OpenAI) when their providers aren't proxied through OpenRouter.
 *
 * For local providers (ollama, local) we return zero pricing with a
 * `runs locally` label so the UI can render `free · runs locally` without
 * any network call.
 *
 * Pricing shape: { input: number, output: number, unit: '1M tokens', currency: 'USD', source }.
 * Numbers are USD per 1M tokens for direct comparability across providers.
 */

import fs from 'node:fs';
import path from 'node:path';

import { doctorRoot } from './config/xdg.mjs';

const DEFAULT_CACHE_FILE = path.join(doctorRoot(), 'model-pricing.json');
const CACHE_TTL_MS = 5 * 60 * 1000;
const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/models';

const STATIC_PRICING = {
  'anthropic/claude-opus-4-6': { input: 15.0, output: 75.0 },
  'anthropic/claude-sonnet-4-6': { input: 3.0, output: 15.0 },
  'anthropic/claude-haiku-4-5-20251001': { input: 0.8, output: 4.0 },
  'openai/gpt-5.4': { input: 12.0, output: 60.0 },
  'openai/gpt-5.1': { input: 2.5, output: 12.5 },
  'openai/gpt-5.1-mini': { input: 0.6, output: 3.0 },
};

const LOCAL_PRICING = { input: 0, output: 0, source: 'local', label: 'free · runs locally' };

function readCache(cacheFile) {
  try {
    const raw = fs.readFileSync(cacheFile, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && parsed.fetchedAt) return parsed;
  } catch { /* cache miss */ }
  return null;
}

function writeCache(cacheFile, payload) {
  try {
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    fs.writeFileSync(cacheFile, JSON.stringify(payload, null, 2));
  } catch { /* non-fatal */ }
}

function isCacheFresh(cache, now = Date.now()) {
  if (!cache || typeof cache.fetchedAt !== 'number') return false;
  const age = now - cache.fetchedAt;
  if (age < 0) return false;
  return age < CACHE_TTL_MS;
}

/**
 * Fetch the OpenRouter catalog. Returns a Map of model id -> { input, output }
 * in USD per 1M tokens. The endpoint returns pricing per token; we multiply
 * by 1e6 so callers compare in the same unit as Anthropic / OpenAI lists.
 */
async function fetchOpenRouterPricing({ fetchImpl = globalThis.fetch, signal } = {}) {
  if (typeof fetchImpl !== 'function') return null;
  let res;
  try {
    res = await fetchImpl(OPENROUTER_ENDPOINT, { signal });
  } catch {
    return null;
  }
  if (!res?.ok) return null;
  let data;
  try { data = await res.json(); } catch { return null; }
  const list = Array.isArray(data?.data) ? data.data : [];
  const map = {};
  for (const entry of list) {
    if (!entry?.id) continue;
    const p = entry.pricing || {};
    const input = Number(p.prompt);
    const output = Number(p.completion);
    if (!Number.isFinite(input) || !Number.isFinite(output)) continue;
    map[`openrouter/${entry.id}`] = {
      input: input * 1_000_000,
      output: output * 1_000_000,
      context: entry.context_length || null,
    };
  }
  return map;
}

/**
 * Resolve pricing for a list of model ids. Always returns an object keyed by
 * model id; missing entries map to null so the UI can render an em-dash.
 */
export async function getPricingForModels(modelIds, { fetchImpl, signal, now = Date.now(), cacheFile = DEFAULT_CACHE_FILE } = {}) {
  const result = {};
  const needsRemote = [];
  for (const id of modelIds || []) {
    if (typeof id !== 'string' || !id) continue;
    if (/^ollama\//.test(id) || /^local\//.test(id)) {
      result[id] = { ...LOCAL_PRICING, unit: '1M tokens', currency: 'USD' };
      continue;
    }
    if (STATIC_PRICING[id]) {
      result[id] = { ...STATIC_PRICING[id], unit: '1M tokens', currency: 'USD', source: 'static' };
      continue;
    }
    if (/^openrouter\//.test(id)) {
      needsRemote.push(id);
      continue;
    }
    result[id] = null;
  }

  if (needsRemote.length === 0) return result;

  let cache = readCache(cacheFile);
  if (!isCacheFresh(cache, now)) {
    const fresh = await fetchOpenRouterPricing({ fetchImpl, signal });
    if (fresh) {
      cache = { fetchedAt: now, models: fresh };
      writeCache(cacheFile, cache);
    }
  }

  const remoteMap = cache?.models ?? {};
  for (const id of needsRemote) {
    const hit = remoteMap[id];
    result[id] = hit
      ? { input: hit.input, output: hit.output, context: hit.context, unit: '1M tokens', currency: 'USD', source: 'openrouter' }
      : null;
  }
  return result;
}

/**
 * Format a pricing entry into a compact selector label like
 * `$3.00 / $15.00 per 1M`. Returns null for missing or all-zero entries so
 * callers can render `free` or an em-dash without branching on each field.
 */
export function formatPricingLabel(entry) {
  if (!entry) return null;
  if (entry.source === 'local' || (entry.input === 0 && entry.output === 0)) {
    return entry.label || 'free · runs locally';
  }
  const input = Number(entry.input);
  const output = Number(entry.output);
  if (!Number.isFinite(input) || !Number.isFinite(output)) return null;
  return `$${input.toFixed(2)} in · $${output.toFixed(2)} out / 1M`;
}
