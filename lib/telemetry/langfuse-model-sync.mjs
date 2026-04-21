/**
 * lib/telemetry/langfuse-model-sync.mjs — Sync live model pricing into Langfuse.
 *
 * Fetches OpenRouter's public model list for live pricing, merges with a static
 * Anthropic table (no machine-readable public pricing API), and upserts all
 * entries into Langfuse's custom model registry so that traces show real costs.
 *
 * Designed to be called once at plugin init; subsequent calls within the same
 * process are skipped via a module-level guard to avoid hammering the APIs.
 */

const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";

// Static Anthropic pricing (USD per token, as of 2026-04).
// No machine-readable public pricing endpoint — update on model price changes.
const ANTHROPIC_MODELS = [
  {
    modelName: "claude-opus-4-7",
    matchPattern: "(?i)^(anthropic/)?claude-opus-4-7$",
    inputPrice: 15 / 1_000_000,
    outputPrice: 75 / 1_000_000,
  },
  {
    modelName: "claude-opus-4-5",
    matchPattern: "(?i)^(anthropic/)?claude-opus-4-5$",
    inputPrice: 15 / 1_000_000,
    outputPrice: 75 / 1_000_000,
  },
  {
    modelName: "claude-sonnet-4-6",
    matchPattern: "(?i)^(anthropic/)?claude-sonnet-4-6$",
    inputPrice: 3 / 1_000_000,
    outputPrice: 15 / 1_000_000,
  },
  {
    modelName: "claude-sonnet-4-5",
    matchPattern: "(?i)^(anthropic/)?claude-sonnet-4-5$",
    inputPrice: 3 / 1_000_000,
    outputPrice: 15 / 1_000_000,
  },
  {
    modelName: "claude-haiku-4-5",
    matchPattern: "(?i)^(anthropic/)?claude-haiku-4-5(-\\d+)?$",
    inputPrice: 0.8 / 1_000_000,
    outputPrice: 4 / 1_000_000,
  },
];

// GitHub Copilot uses a per-request billing model, not per-token.
// Register at $0 so Langfuse records usage without phantom costs.
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
  const entry = {
    modelName: model.modelName,
    inputPrice: Number(model.inputPrice) || 0,
    outputPrice: Number(model.outputPrice) || 0,
    source: model.source || "catalog",
  };
  map.set(key, entry);
  if (key.startsWith("anthropic/")) map.set(key.replace(/^anthropic\//, ""), entry);
  if (key.startsWith("github-copilot/")) map.set(key.replace(/^github-copilot\//, ""), entry);
  if (key.startsWith("openrouter/")) map.set(key.replace(/^openrouter\//, ""), entry);
}

export function buildPricingCatalog(openRouterModels = []) {
  const map = new Map();
  for (const model of [...ANTHROPIC_MODELS, ...GITHUB_COPILOT_MODELS]) {
    indexPricingEntry(map, { ...model, source: "static" });
  }
  for (const model of openRouterModels) {
    indexPricingEntry(map, { ...model, source: "openrouter" });
  }
  return map;
}

export function resolveModelPricing(modelName, catalog = cachedPricingCatalog) {
  const key = normalizeModelKey(modelName);
  if (!key) return null;
  return catalog.get(key) || null;
}

export function estimateUsageCost(modelName, usage = {}, catalog = cachedPricingCatalog) {
  const pricing = resolveModelPricing(modelName, catalog);
  if (!pricing) return { costUsd: 0, costSource: "unavailable", modelName: modelName || null };

  const inputTokens = Number(usage.inputTokens ?? 0);
  const outputTokens = Number(usage.outputTokens ?? 0);
  const reasoningTokens = Number(usage.reasoningTokens ?? 0);
  const billableOutputTokens = outputTokens + reasoningTokens;
  const inputCost = inputTokens * pricing.inputPrice;
  const outputCost = billableOutputTokens * pricing.outputPrice;
  const costUsd = inputCost + outputCost;

  return {
    costUsd,
    costSource: `estimated:${pricing.source}`,
    modelName: pricing.modelName,
    pricing,
    breakdown: {
      inputCostUsd: inputCost,
      outputCostUsd: outputCost,
      billableInputTokens: inputTokens,
      billableOutputTokens,
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
        // Escape dots and slashes in match pattern
        const escaped = m.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        return {
          modelName: m.id,
          matchPattern: `(?i)^${escaped}$`,
          inputPrice,
          outputPrice,
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
  } catch { /* return what we have */ }
  return all;
}

async function deleteLangfuseModel(baseUrl, authHeader, id, fetchImpl) {
  try {
    await fetchImpl(`${baseUrl}/api/public/models/${id}`, {
      method: "DELETE",
      headers: { Authorization: authHeader },
      signal: AbortSignal.timeout(5_000),
    });
  } catch { /* best effort */ }
}

async function upsertLangfuseModel(baseUrl, authHeader, model, existing, fetchImpl) {
  const match = existing.find((e) => e.modelName === model.modelName);
  if (match) {
    // Langfuse has no PATCH; delete then recreate if pricing changed.
    const priceChanged =
      Math.abs((match.inputPrice ?? 0) - model.inputPrice) > 1e-12 ||
      Math.abs((match.outputPrice ?? 0) - model.outputPrice) > 1e-12;
    if (!priceChanged) return "unchanged";
    await deleteLangfuseModel(baseUrl, authHeader, match.id, fetchImpl);
  }
  const body = JSON.stringify({
    modelName: model.modelName,
    matchPattern: model.matchPattern,
    unit: "TOKENS",
    inputPrice: model.inputPrice,
    outputPrice: model.outputPrice,
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

  const [openRouterModels, existing] = await Promise.all([
    fetchOpenRouterModels(fetchImpl),
    listLangfuseModels(baseUrl, authHeader, fetchImpl),
  ]);

  const allModels = [...ANTHROPIC_MODELS, ...GITHUB_COPILOT_MODELS, ...openRouterModels];
  cachedPricingCatalog = buildPricingCatalog(openRouterModels);

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
