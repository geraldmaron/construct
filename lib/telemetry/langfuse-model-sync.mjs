/**
 * lib/telemetry/langfuse-model-sync.mjs — Sync live model pricing into Langfuse.
 *
 * Pricing source priority (highest to lowest):
 *   1. Static table — cold-start fallback; always wins for known Anthropic/Copilot models
 *   2. LiteLLM pricing JSON — community-maintained, no auth, fetched at startup with 24h disk cache
 *   3. OpenRouter — live but includes markup; used for Langfuse sync only, not cost accounting
 *
 * Anthropic prompt-caching ratios applied against base input price:
 *   cache_read       = 0.10 × input
 *   cache_write_5m   = 1.25 × input
 *   cache_write_1h   = 2.00 × input
 *
 * @see https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";
const LITELLM_PRICING_URL =
  "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";
const PRICING_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const PRICING_CACHE_PATH = join(homedir(), ".cx", "pricing-cache.json");

// Anthropic cache pricing multipliers applied against the base input price.
const ANTHROPIC_CACHE_READ_RATIO = 0.1;
const ANTHROPIC_CACHE_WRITE_5M_RATIO = 1.25;
const ANTHROPIC_CACHE_WRITE_1H_RATIO = 2.0;

function withAnthropicCachePricing(entry) {
  const inputPrice = entry.inputPrice;
  return {
    ...entry,
    cacheReadPrice: inputPrice * ANTHROPIC_CACHE_READ_RATIO,
    cacheWrite5mPrice: inputPrice * ANTHROPIC_CACHE_WRITE_5M_RATIO,
    cacheWrite1hPrice: inputPrice * ANTHROPIC_CACHE_WRITE_1H_RATIO,
  };
}

async function fetchLiteLLMPricing(fetchImpl = globalThis.fetch) {
  try {
    if (existsSync(PRICING_CACHE_PATH)) {
      const cached = JSON.parse(readFileSync(PRICING_CACHE_PATH, "utf8"));
      if (cached?.fetchedAt && Date.now() - cached.fetchedAt < PRICING_CACHE_TTL_MS) {
        return cached.models || [];
      }
    }
  } catch { /* non-critical */ }

  try {
    const res = await fetchImpl(LITELLM_PRICING_URL, {
      headers: { "User-Agent": "construct-telemetry/1.0" },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return [];
    const raw = await res.json();
    const models = [];
    for (const [id, data] of Object.entries(raw)) {
      if (!data?.input_cost_per_token) continue;
      const inputPrice = Number(data.input_cost_per_token) || 0;
      const outputPrice = Number(data.output_cost_per_token) || 0;
      const cacheReadPrice = Number(data.cache_read_input_token_cost) || 0;

      // LiteLLM exposes a single cache_creation field with no 5m/1h split.
      // Map it to 5m; fall back to the ratio for 1h.

      const cacheWrite5mPrice = Number(data.cache_creation_input_token_cost) || 0;
      const cacheWrite1hPrice =
        Number(data.cache_creation_input_token_cost_1h) ||
        inputPrice * ANTHROPIC_CACHE_WRITE_1H_RATIO;
      const maxInputTokens = Number(data.max_input_tokens) || 0;
      const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      models.push({
        modelName: id,
        matchPattern: `(?i)^${escaped}$`,
        inputPrice,
        outputPrice,
        cacheReadPrice,
        cacheWrite5mPrice,
        cacheWrite1hPrice,
        maxInputTokens,
        source: "litellm",
      });
    }
    try {
      mkdirSync(join(homedir(), ".cx"), { recursive: true });
      writeFileSync(PRICING_CACHE_PATH, JSON.stringify({ fetchedAt: Date.now(), models }));
    } catch { /* non-critical */ }
    return models;
  } catch {
    return [];
  }
}

const ANTHROPIC_MODELS = [
  {
    modelName: "claude-opus-4-7",
    matchPattern: "(?i)^(anthropic/)?claude-opus-4-7$",
    inputPrice: 15 / 1_000_000,
    outputPrice: 75 / 1_000_000,
    maxInputTokens: 200_000,
  },
  {
    modelName: "claude-opus-4-5",
    matchPattern: "(?i)^(anthropic/)?claude-opus-4-5$",
    inputPrice: 15 / 1_000_000,
    outputPrice: 75 / 1_000_000,
    maxInputTokens: 200_000,
  },
  {
    modelName: "claude-sonnet-4-6",
    matchPattern: "(?i)^(anthropic/)?claude-sonnet-4-6$",
    inputPrice: 3 / 1_000_000,
    outputPrice: 15 / 1_000_000,
    maxInputTokens: 200_000,
  },
  {
    modelName: "claude-sonnet-4-5",
    matchPattern: "(?i)^(anthropic/)?claude-sonnet-4-5$",
    inputPrice: 3 / 1_000_000,
    outputPrice: 15 / 1_000_000,
    maxInputTokens: 200_000,
  },
  {
    modelName: "claude-haiku-4-5",
    matchPattern: "(?i)^(anthropic/)?claude-haiku-4-5(-\\d+)?$",
    inputPrice: 1 / 1_000_000,
    outputPrice: 5 / 1_000_000,
    maxInputTokens: 200_000,
  },
].map(withAnthropicCachePricing);

// Per-request billing — register at $0 so Langfuse records usage without phantom costs.
const GITHUB_COPILOT_MODELS = [
  { modelName: "github-copilot/gpt-5.4", matchPattern: "(?i)^(github-copilot/)?gpt-5\\.4$" },
  { modelName: "github-copilot/gpt-4.1", matchPattern: "(?i)^(github-copilot/)?gpt-4\\.1$" },
  { modelName: "github-copilot/claude-sonnet-4-5", matchPattern: "(?i)^github-copilot/claude-sonnet" },
  { modelName: "github-copilot/gemini-2.5-pro", matchPattern: "(?i)^github-copilot/gemini" },
  { modelName: "github-copilot/o4-mini", matchPattern: "(?i)^github-copilot/o4" },
].map((m) => ({ ...m, inputPrice: 0, outputPrice: 0 }));

let syncDone = false;
let cachedPricingCatalog = buildPricingCatalog();

function normalizeModelKey(modelName = "") {
  return String(modelName ?? "").trim().toLowerCase();
}

function indexPricingEntry(map, model) {
  if (!model?.modelName) return;
  const key = normalizeModelKey(model.modelName);
  const inputPrice = Number(model.inputPrice) || 0;
  const entry = {
    modelName: model.modelName,
    inputPrice,
    outputPrice: Number(model.outputPrice) || 0,
    cacheReadPrice: Number(model.cacheReadPrice) || 0,
    cacheWrite5mPrice: Number(model.cacheWrite5mPrice) || 0,
    cacheWrite1hPrice: Number(model.cacheWrite1hPrice) || 0,
    maxInputTokens: Number(model.maxInputTokens) || 0,
    source: model.source || "catalog",
  };
  map.set(key, entry);
  if (key.startsWith("anthropic/")) map.set(key.replace(/^anthropic\//, ""), entry);
  if (key.startsWith("github-copilot/")) map.set(key.replace(/^github-copilot\//, ""), entry);
  if (key.startsWith("openrouter/")) map.set(key.replace(/^openrouter\//, ""), entry);
}

// Static entries are indexed last so they always win over litellm and openrouter.
export function buildPricingCatalog(openRouterModels = [], litellmModels = []) {
  const map = new Map();
  for (const model of openRouterModels) {
    indexPricingEntry(map, { ...model, source: "openrouter" });
  }
  for (const model of litellmModels) {
    indexPricingEntry(map, { ...model, source: model.source || "litellm" });
  }
  for (const model of [...ANTHROPIC_MODELS, ...GITHUB_COPILOT_MODELS]) {
    indexPricingEntry(map, { ...model, source: "static" });
  }
  return map;
}

export function resolveModelPricing(modelName, catalog = cachedPricingCatalog) {
  const key = normalizeModelKey(modelName);
  if (!key) return null;
  return catalog.get(key) || null;
}

// Anthropic's two published context tiers. Treated as model facts, not tunables:
//   200k — baseline across Opus/Sonnet/Haiku
//   1M   — Anthropic's beta long-context tier (anthropic-beta: context-1m-*)
// Resolution prefers catalog data; if observed usage exceeds catalog baseline
// the session must be on the next published tier, so we step up to it rather
// than treating the observation itself as the ceiling.
const ANTHROPIC_TIERS = [200_000, 1_000_000];

// Resolves the active context window in tokens for a given model. Catalog
// maxInputTokens (LiteLLM live or static) is the primary source. Observation
// above the catalog baseline implies a higher published tier — step up to it
// rather than treat the observation itself as the ceiling. Final fallback is
// the smallest published tier (200k).

export function resolveContextWindow(modelName, observedMaxTokens = 0, catalog = cachedPricingCatalog) {
  const observed = Number(observedMaxTokens) || 0;
  const pricing = resolveModelPricing(modelName, catalog);
  const catalogWindow = Number(pricing?.maxInputTokens) || 0;
  const baseline = catalogWindow || ANTHROPIC_TIERS[0];
  if (observed > baseline) {
    const nextTier = ANTHROPIC_TIERS.find((tier) => tier >= observed);
    return nextTier || observed;
  }
  return baseline;
}

export function estimateUsageCost(modelName, usage = {}, catalog = cachedPricingCatalog) {
  const pricing = resolveModelPricing(modelName, catalog);
  if (!pricing) return { costUsd: 0, costSource: "unavailable", modelName: modelName || null };

  const inputTokens = Number(usage.inputTokens ?? 0);
  const outputTokens = Number(usage.outputTokens ?? 0);
  const reasoningTokens = Number(usage.reasoningTokens ?? 0);
  const cacheReadInputTokens = Number(usage.cacheReadInputTokens ?? 0);
  const cacheCreation5mInputTokens = Number(usage.cacheCreation5mInputTokens ?? 0);
  const cacheCreation1hInputTokens = Number(usage.cacheCreation1hInputTokens ?? 0);
  const explicitCacheCreationInputTokens = Number(usage.cacheCreationInputTokens ?? 0);

  // Aggregate cache_creation minus the known split subtypes; remainder billed at 5m rate.
  const residualCacheCreationInputTokens = Math.max(
    0,
    explicitCacheCreationInputTokens - cacheCreation5mInputTokens - cacheCreation1hInputTokens,
  );

  const billableOutputTokens = outputTokens + reasoningTokens;
  const cacheReadPrice = pricing.cacheReadPrice || pricing.inputPrice * ANTHROPIC_CACHE_READ_RATIO;
  const cacheWrite5mPrice = pricing.cacheWrite5mPrice || pricing.inputPrice * ANTHROPIC_CACHE_WRITE_5M_RATIO;
  const cacheWrite1hPrice = pricing.cacheWrite1hPrice || pricing.inputPrice * ANTHROPIC_CACHE_WRITE_1H_RATIO;

  const inputCost = inputTokens * pricing.inputPrice;
  const cacheReadCost = cacheReadInputTokens * cacheReadPrice;
  const cacheWrite5mCost = (cacheCreation5mInputTokens + residualCacheCreationInputTokens) * cacheWrite5mPrice;
  const cacheWrite1hCost = cacheCreation1hInputTokens * cacheWrite1hPrice;
  const outputCost = billableOutputTokens * pricing.outputPrice;
  const costUsd = inputCost + cacheReadCost + cacheWrite5mCost + cacheWrite1hCost + outputCost;

  return {
    costUsd,
    costSource: `estimated:${pricing.source}`,
    modelName: pricing.modelName,
    pricing,
    breakdown: {
      inputCostUsd: inputCost,
      cacheReadCostUsd: cacheReadCost,
      cacheWrite5mCostUsd: cacheWrite5mCost,
      cacheWrite1hCostUsd: cacheWrite1hCost,
      outputCostUsd: outputCost,
      billableInputTokens: inputTokens,
      billableOutputTokens,
      cacheReadInputTokens,
      cacheCreation5mInputTokens: cacheCreation5mInputTokens + residualCacheCreationInputTokens,
      cacheCreation1hInputTokens,
    },
  };
}

function buildAuthHeader(publicKey, secretKey) {
  return `Basic ${Buffer.from(`${publicKey}:${secretKey}`).toString("base64")}`;
}

async function fetchOpenRouterModels(fetchImpl = globalThis.fetch) {
  try {
    const res = await fetchImpl(OPENROUTER_MODELS_URL, {
      headers: { "User-Agent": "construct-telemetry/1.0" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return [];
    const { data } = await res.json();
    if (!Array.isArray(data)) return [];
    return data
      .filter((m) => m?.id && m?.pricing)
      .map((m) => {
        const inputPrice = parseFloat(m.pricing.prompt) || 0;
        const outputPrice = parseFloat(m.pricing.completion) || 0;
        const cacheReadPrice = parseFloat(m.pricing.input_cache_read) || 0;
        const cacheWritePrice = parseFloat(m.pricing.input_cache_write) || 0;
        const escaped = m.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        return {
          modelName: m.id,
          matchPattern: `(?i)^(openrouter/)?${escaped}$`,
          inputPrice,
          outputPrice,
          cacheReadPrice,
          cacheWrite5mPrice: cacheWritePrice,
          cacheWrite1hPrice: cacheWritePrice,
        };
      });
  } catch {
    return [];
  }
}

async function listLangfuseModels(baseUrl, authHeader, fetchImpl) {
  const all = [];
  let page = 1;
  try {
    while (true) {
      const res = await fetchImpl(`${baseUrl}/api/public/models?limit=100&page=${page}`, {
        headers: { Authorization: authHeader },
        signal: AbortSignal.timeout(8_000),
      });
      if (!res.ok) break;
      const body = await res.json();
      const items = Array.isArray(body?.data) ? body.data : [];
      all.push(...items);
      if (items.length < 100) break;
      page++;
    }
  } catch { /* non-critical */ }
  return all;
}

async function deleteLangfuseModel(baseUrl, authHeader, id, fetchImpl) {
  try {
    await fetchImpl(`${baseUrl}/api/public/models/${id}`, {
      method: "DELETE",
      headers: { Authorization: authHeader },
      signal: AbortSignal.timeout(5_000),
    });
  } catch { /* non-critical */ }
}

async function upsertLangfuseModel(baseUrl, authHeader, model, existing, fetchImpl) {
  const match = existing.find((e) => e.modelName === model.modelName);
  if (match) {
    const priceChanged =
      Math.abs((match.inputPrice ?? 0) - (model.inputPrice ?? 0)) > 1e-12 ||
      Math.abs((match.outputPrice ?? 0) - (model.outputPrice ?? 0)) > 1e-12 ||
      Math.abs((match.cacheReadPrice ?? 0) - (model.cacheReadPrice ?? 0)) > 1e-12 ||
      Math.abs((match.cacheWrite5mPrice ?? 0) - (model.cacheWrite5mPrice ?? 0)) > 1e-12 ||
      Math.abs((match.cacheWrite1hPrice ?? 0) - (model.cacheWrite1hPrice ?? 0)) > 1e-12;
    const patternChanged = (match.matchPattern ?? '') !== (model.matchPattern ?? '');
    if (!priceChanged && !patternChanged) return "unchanged";
    await deleteLangfuseModel(baseUrl, authHeader, match.id, fetchImpl);
  }
  const prices = {
    input: { price: Number(model.inputPrice) || 0 },
    output: { price: Number(model.outputPrice) || 0 },
  };
  if (model.cacheReadPrice) prices.input_cache_read = { price: Number(model.cacheReadPrice) };
  if (model.cacheWrite5mPrice) prices.input_cache_write_5m = { price: Number(model.cacheWrite5mPrice) };
  if (model.cacheWrite1hPrice) prices.input_cache_write_1h = { price: Number(model.cacheWrite1hPrice) };
  const body = JSON.stringify({
    modelName: model.modelName,
    matchPattern: model.matchPattern,
    unit: "TOKENS",
    inputPrice: Number(model.inputPrice) || 0,
    outputPrice: Number(model.outputPrice) || 0,
    prices,
    tokenizerId: model.modelName.includes("claude") ? "claude" : null,
  });
  try {
    const res = await fetchImpl(`${baseUrl}/api/public/models`, {
      method: "POST",
      headers: { Authorization: authHeader, "Content-Type": "application/json" },
      body,
      signal: AbortSignal.timeout(5_000),
    });
    return res.ok ? "created" : "error";
  } catch {
    return "error";
  }
}

/**
 * Refresh the in-process pricing catalog from LiteLLM (24h disk cache). Safe to call
 * at plugin init — returns immediately when the cache is fresh. Does not touch Langfuse.
 *
 * @param {Function} [fetchImpl]
 * @returns {Promise<void>}
 */
export async function refreshPricingCatalog(fetchImpl = globalThis.fetch) {
  const litellmModels = await fetchLiteLLMPricing(fetchImpl);
  if (litellmModels.length > 0) {
    cachedPricingCatalog = buildPricingCatalog([], litellmModels);
  }
}

/**
 * Syncs model pricing into Langfuse. Safe to call multiple times — only runs once per process.
 *
 * @param {object} opts
 * @param {string} opts.baseUrl — Langfuse base URL
 * @param {string} opts.publicKey
 * @param {string} opts.secretKey
 * @param {Function} [opts.fetchImpl] — injectable fetch for tests
 * @param {boolean} [opts.force] — bypass the once-per-process guard
 * @returns {Promise<{synced: number, unchanged: number, errors: number}>}
 */
export async function syncModelPricing({
  baseUrl = (process.env.LANGFUSE_BASEURL ?? "https://cloud.langfuse.com").replace(/\/$/, ""),
  publicKey = process.env.LANGFUSE_PUBLIC_KEY,
  secretKey = process.env.LANGFUSE_SECRET_KEY,
  fetchImpl = globalThis.fetch,
  force = false,
} = {}) {
  if (!force && syncDone) return { synced: 0, unchanged: 0, errors: 0 };
  if (!publicKey || !secretKey || !fetchImpl) return { synced: 0, unchanged: 0, errors: 0 };

  syncDone = true;

  const authHeader = buildAuthHeader(publicKey, secretKey);

  const [openRouterModels, litellmModels, existing] = await Promise.all([
    fetchOpenRouterModels(fetchImpl),
    fetchLiteLLMPricing(fetchImpl),
    listLangfuseModels(baseUrl, authHeader, fetchImpl),
  ]);

  cachedPricingCatalog = buildPricingCatalog(openRouterModels, litellmModels);

  const byKey = new Map();
  for (const model of openRouterModels) byKey.set(normalizeModelKey(model.modelName), model);
  for (const model of litellmModels) byKey.set(normalizeModelKey(model.modelName), model);
  for (const model of [...ANTHROPIC_MODELS, ...GITHUB_COPILOT_MODELS]) {
    byKey.set(normalizeModelKey(model.modelName), model);
  }
  const allModels = [...byKey.values()];

  let synced = 0;
  let unchanged = 0;
  let errors = 0;

  for (const model of allModels) {
    const result = await upsertLangfuseModel(baseUrl, authHeader, model, existing, fetchImpl);
    if (result === "created") synced++;
    else if (result === "unchanged") unchanged++;
    else errors++;
  }

  return { synced, unchanged, errors };
}

export function resetSyncGuard() {
  syncDone = false;
}

export function resetPricingCatalog() {
  cachedPricingCatalog = buildPricingCatalog();
}
