/**
 * lib/model-router.mjs — Central model routing and selection logic.
 *
 * What it does:
 *   • Defines provider-family tier mappings and resolves model IDs.
 *   • Polls OpenRouter for free models, scores them, and selects appropriate
 *     alternatives for each tier (reasoning, standard, fast).
 *   • Provides helpers to apply free-preference modes (global, same‑family,
 *     explicit selection) and to persist selections to .env.
 *
 * Consumed by:
 *   • lib/cli-commands.mjs   – model configuration commands.
 *   • lib/model-router.mjs   – internal model inference utilities.
 *   • lib/setup.mjs          – environment variable generation.
 *
 * Maintenance:
 *   • Adding new provider families → extend `PROVIDER_FAMILY_TIERS` with a
 *     `test`/`resolve` entry.
 *   • Changing scoring logic → modify `_score()` function.
 *   • Adjusting token‑budget behavior → edit `applyFreeSameFamilyPreferenceToTierSet()`.
 *   • Persisting selections → update `applyToEnv()` comment block.
 */
import fs from "node:fs";
import path from "node:path";
import { findOpenCodeConfigPath } from "./opencode-config.mjs";

const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";
const FETCH_TIMEOUT_MS = 10_000;

/**
 * Built‑in default model IDs for each tier when no overrides are present.
 */
const BUILTIN_DEFAULTS = {
  reasoning: "openrouter/deepseek/deepseek-r1",
  standard: "openrouter/qwen/qwen3-coder:free",
  fast: "openrouter/meta-llama/llama-3.3-70b-instruct:free",
};

export const MODEL_TIER_BY_WORK_CATEGORY = {
  visual: "standard",
  deep: "reasoning",
  quick: "fast",
  writing: "fast",
  analysis: "standard",
};

/**
 * Provider‑family definitions. Each entry contains:
 *   - `test`: RegExp that matches provider URLs.
 *   - `resolve`: Function that maps selected tier values to concrete model IDs.
 *
 * Families are consulted in order; the first match wins.
 */
const PROVIDER_FAMILY_TIERS = [
  {
    test: (modelId) => /^anthropic\//.test(modelId),
    resolve: ({ reasoning, standard, fast }) => ({
      reasoning: reasoning ?? "anthropic/claude-opus-4-6",
      standard: standard ?? "anthropic/claude-sonnet-4-6",
      fast: fast ?? "anthropic/claude-haiku-4-5-20251001",
    }),
  },
  {
    test: (modelId) => /^openrouter\/anthropic\//.test(modelId),
    resolve: ({ reasoning, standard, fast }) => ({
      reasoning: reasoning ?? "openrouter/anthropic/claude-opus-4-6",
      standard: standard ?? "openrouter/anthropic/claude-sonnet-4-6",
      fast: fast ?? "openrouter/anthropic/claude-haiku-4-5-20251001",
    }),
  },
  {
    test: (modelId) => /^openrouter\/google\//.test(modelId),
    resolve: ({ reasoning, standard, fast }) => ({
      reasoning: reasoning ?? "openrouter/google/gemini-2.5-pro",
      standard: standard ?? "openrouter/google/gemini-2.0-flash-001",
      fast: fast ?? "openrouter/google/gemma-3-27b-it:free",
    }),
  },
  {
    test: (modelId) => /^openrouter\/deepseek\//.test(modelId),
    resolve: ({ reasoning, standard, fast }) => ({
      reasoning: reasoning ?? "openrouter/deepseek/deepseek-r1",
      standard: standard ?? "openrouter/deepseek/deepseek-v3",
      fast: fast ?? standard ?? "openrouter/qwen/qwen3-coder:free",
    }),
  },
  {
    test: (modelId) => /^openrouter\/qwen\//.test(modelId),
    resolve: ({ reasoning, standard, fast }) => ({
      reasoning: reasoning ?? "openrouter/qwen/qwen3-coder",
      standard: standard ?? "openrouter/qwen/qwen3-coder:free",
      fast: fast ?? "openrouter/qwen/qwen2.5-coder-32b-instruct",
    }),
  },
  {
    test: (modelId) => /^github-copilot\//.test(modelId),
    resolve: ({ reasoning, standard, fast }) => ({
      reasoning: reasoning ?? "github-copilot/gpt-5.4",
      standard: standard ?? "github-copilot/gpt-5.1",
      fast: fast ?? "github-copilot/gpt-5.1-mini",
    }),
  },
  {
    test: (modelId) => /^openai\//.test(modelId) || /^openrouter\/openai\//.test(modelId),
    resolve: ({ reasoning, standard, fast }) => {
      const prefix = /^openrouter\//.test(reasoning || standard || fast || "") ? "openrouter/openai" : "openai";
      return {
        reasoning: reasoning ?? `${prefix}/gpt-5.4`,
        standard: standard ?? `${prefix}/gpt-5.1`,
        fast: fast ?? `${prefix}/gpt-5.1-mini`,
      };
    },
  },
  {
    test: (modelId) => /^openrouter\/meta-llama\//.test(modelId),
    resolve: ({ reasoning, standard, fast }) => ({
      reasoning: reasoning ?? "openrouter/meta-llama/llama-3.1-405b-instruct",
      standard: standard ?? "openrouter/meta-llama/llama-3.3-70b-instruct",
      fast: fast ?? "openrouter/meta-llama/llama-3.3-70b-instruct:free",
    }),
  },
];

/**
 * Find the provider‑family entry that matches a given model identifier.
 * @param {string} modelId – The model ID string.
 * @returns {object|null} – The matching tier‑resolution object, or `null`.
 */
function matchProviderFamily(modelId) {
  return PROVIDER_FAMILY_TIERS.find((entry) => entry.test(modelId));
}

/**
 * Given a primary model the user selected, return tier → modelId mapping in
 * the same provider family. Returns null if no family matches (caller should
 * fall back to configured CX_MODEL_* values).
 */
export function resolveTiersForPrimary(primaryModelId) {
  if (!primaryModelId || typeof primaryModelId !== "string") return null;
  const family = matchProviderFamily(primaryModelId);
  if (!family) return null;
  return family.resolve({ reasoning: undefined, standard: undefined, fast: undefined });
}

/**
 * Read the OpenRouter API key from the OpenCode config file instead of
 * requiring it to be exported as `OPENROUTER_API_KEY`.
 * @param {string} configPath – Path to the OpenCode config (defaults to the
 *   standard location).
 * @returns {string} – The API key, or an empty string if not found.
 */
export function readOpenRouterApiKeyFromOpenCodeConfig(
  configPath = findOpenCodeConfigPath(),
) {
  try {
    if (!fs.existsSync(configPath)) return "";
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    const auth = config?.provider?.openrouter?.options?.headers?.Authorization;
    if (typeof auth !== "string") return "";
    const value = auth.replace(/^Bearer\s+/i, "").trim();
    if (!value || value.includes("__OPENROUTER_API_KEY__")) return "";
    return value;
  } catch {
    return "";
  }
}

/**
 * Fetch the list of currently available free models from OpenRouter.
 * Returns an array sorted by descending capability score.
 * Returns `[]` (with a logged error) if the API key is missing or the request fails.
 * @param {string} apiKey – OpenRouter bearer token.
 * @returns {Promise<Array<{id:string,name:string,contextLength:number,isFree:boolean,score:number}>>}
 */
export async function pollFreeModels(apiKey) {
  if (!apiKey) {
    console.error(
      "Error: OPENROUTER_API_KEY is not set. Cannot poll free models."
    );
    return [];
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let data;
  try {
    const res = await fetch(OPENROUTER_MODELS_URL, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    });
    if (!res.ok) {
      console.error(
        `Error: OpenRouter models endpoint returned ${res.status} ${res.statusText}`
      );
      return [];
    }
    data = await res.json();
  } catch (err) {
    if (err.name === "AbortError") {
      console.error(
        "Error: OpenRouter request timed out after 10 seconds."
      );
    } else {
      console.error(`Error: Failed to fetch OpenRouter models — ${err.message}`);
    }
    return [];
  } finally {
    clearTimeout(timeout);
  }

  const models = (data?.data ?? [])
    .filter(
      (m) =>
        m?.pricing?.prompt === "0" && m?.pricing?.completion === "0"
    )
    .map((m) => ({
      id: `openrouter/${m.id}`,
      name: m.name ?? m.id,
      contextLength: m.context_length ?? 0,
      isFree: true,
    }));

  return models.sort((a, b) => _score(b, "standard") - _score(a, "standard"));
}

/**
 * Score a model for a given tier (higher is better).
 * @private
 * @param {object} model – Model object as returned by `pollFreeModels`.
 * @param {"reasoning"|"standard"|"fast"} tier – The tier to score for.
 * @returns {number} – Numerical score used for ranking.
 */
function _score(model, tier) {
  const { id, contextLength } = model;
  let score = 0;

  // Context‑length weighting
  if (contextLength >= 128_000) score += 40;
  else if (contextLength >= 32_000) score += 20;
  else if (contextLength >= 16_000) score += 10;

  // Provider‑agnostic capability weighting – no vendor bias
  if (id.includes("gemma-4")) score += 30;
  if (id.includes("gemma-3")) score += 25;
  if (id.includes("gpt-4o")) score += 25;
  if (id.includes("nemotron-3-super")) score += 20;
  if (id.includes("llama-3.3-70b")) score += 20;
  if (id.includes("qwen3") && contextLength >= 32_000) score += 20;
  if (id.includes("deepseek-r1")) score += 20;
  if (id.includes("deepseek-v3")) score += 15;
  // Extra boost for reasoning‑heavy models when the tier is reasoning
  if (
    tier === "reasoning" &&
    (id.includes("deepseek-r1") ||
      id.includes("nemotron-3-super") ||
      id.includes("qwen3"))
  ) {
    score += 15;
  }

  return score;
}

/**
 * Read CX_MODEL_* assignments from a .env file.
 * @param {string} envPath – Path to the .env file.
 * @returns {{reasoning:any,standard:any,fast:any}} – Current values.
 */
function readEnvAssignments(envPath) {
  const tierKeys = {
    reasoning: "CX_MODEL_REASONING",
    standard: "CX_MODEL_STANDARD",
    fast: "CX_MODEL_FAST",
  };

  const envValues = {};
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
      const trimmed = line.trim();
      if (trimmed.startsWith("#") || !trimmed.includes("=")) continue;
      const eqIdx = trimmed.indexOf("=");
      const k = trimmed.slice(0, eqIdx).trim();
      const v = trimmed.slice(eqIdx + 1).trim();
      envValues[k] = v;
    }
  }

  return Object.fromEntries(
    Object.entries(tierKeys).map(([tier, key]) => [tier, envValues[key] || null])
  );
}

/**
 * Extract the primary model ID from a definition that may be a string or an object.
 * @param {string|object} def – Definition to inspect.
 * @returns {string|null} – Primary model ID if found.
 */
function extractPrimary(def) {
  if (typeof def === "string") return def;
  if (def && typeof def === "object")
    return def.primary ?? def.fallback?.[0] ?? null;
  return null;
}

/**
 * Build a defaults object from registry‑provided model mappings.
 * Falls back to `BUILTIN_DEFAULTS` when a registry entry is missing.
 * @param {{reasoning:any,standard:any,fast:any}} registryModels – Optional overrides.
 * @returns {{reasoning:string,standard:string,fast:string}} – Resolved defaults.
 */
function getRegistryDefaults(registryModels = {}) {
  return {
    reasoning:
      extractPrimary(registryModels.reasoning) ??
      BUILTIN_DEFAULTS.reasoning,
    standard:
      extractPrimary(registryModels.standard) ??
      BUILTIN_DEFAULTS.standard,
    fast: extractPrimary(registryModels.fast) ?? BUILTIN_DEFAULTS.fast,
  };
}

function normalizeEnvAssignments(envValues = {}) {
  return {
    reasoning: envValues.reasoning ?? envValues.CX_MODEL_REASONING ?? null,
    standard: envValues.standard ?? envValues.CX_MODEL_STANDARD ?? null,
    fast: envValues.fast ?? envValues.CX_MODEL_FAST ?? null,
  };
}

function flattenText(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(flattenText).join("\n");
  if (typeof value === "object") return Object.values(value).map(flattenText).join("\n");
  return "";
}

function providerKey(modelId = "") {
  if (typeof modelId !== "string" || !modelId) return "";
  return modelId.replace(/^openrouter\//, "").split("/")[0] || "";
}

function resolveTierDefinition(definition) {
  if (!definition || typeof definition !== "object") return { primary: null, fallback: [] };
  return {
    primary: extractPrimary(definition),
    fallback: Array.isArray(definition.fallback) ? definition.fallback.filter((entry) => typeof entry === "string" && entry) : [],
  };
}

export function classifyProviderFailure(input) {
  const error = input?.error && typeof input.error === "object" ? input.error : input;
  const text = flattenText([
    error?.message,
    error?.name,
    error?.code,
    error?.status,
    error?.statusCode,
    input?.message,
    input?.error,
  ]);
  if (!text) return null;

  const provider = [
    error?.provider,
    input?.provider,
    input?.model?.provider,
    input?.session?.provider,
  ].find((value) => typeof value === "string" && value) || null;

  const patterns = [
    { kind: "rate_limit", retryable: true, test: /\b429\b|rate limit|usage limits?|too many requests|quota exceeded|weekly limit|monthly limit|daily limit/i },
    { kind: "provider_unavailable", retryable: true, test: /model unavailable|model.*overloaded|ProviderModelNotFoundError|model.*not found|no such model/i },
    { kind: "provider_unavailable", retryable: true, test: /service unavailable|temporarily unavailable|upstream error|server error|\b5\d\d\b/i },
    { kind: "transient_network", retryable: true, test: /timeout|timed out|ETIMEDOUT|ECONNRESET|network error|fetch failed/i },
    { kind: "auth_error", retryable: false, test: /unauthorized|forbidden|invalid api key|authentication failed/i },
  ];

  for (const pattern of patterns) {
    if (pattern.test.test(text)) {
      return {
        kind: pattern.kind,
        provider,
        retryable: pattern.retryable,
      };
    }
  }

  return null;
}

export function resolveFallbackAction({
  failure,
  requestedTier = null,
  workCategory = null,
  currentModels = null,
  registryModels = {},
} = {}) {
  const classified = failure && typeof failure === "object" ? failure : classifyProviderFailure(failure);
  if (!classified || !classified.retryable) return null;

  const tier = requestedTier ?? selectModelTierForWorkCategory(workCategory) ?? "standard";
  const tierDef = resolveTierDefinition(registryModels[tier]);
  const currentModel = currentModels && typeof currentModels === "object"
    ? (currentModels[tier]?.model ?? currentModels[tier] ?? null)
    : null;
  const currentProvider = providerKey(currentModel || "");
  const failingProvider = providerKey(classified.provider || "");

  const candidates = [
    tierDef.primary,
    ...tierDef.fallback,
  ]
    .filter((modelId) => typeof modelId === "string" && modelId)
    .filter((modelId) => modelId !== currentModel)
    .filter((modelId) => {
      const candidateProvider = providerKey(modelId);
      if (!candidateProvider) return true;
      if (failingProvider && candidateProvider === failingProvider) return false;
      if (currentProvider && candidateProvider === currentProvider) return false;
      return true;
    });

  const targetModel = candidates[0] ?? null;
  if (!targetModel) return null;

  return {
    action: "apply-models",
    reason: classified.kind,
    targetModel,
    tier,
  };
}

function resolveTierAssignments(envValues = {}, registryModels = {}) {
  const normalizedEnv = normalizeEnvAssignments(envValues);
  const explicitSources = envValues?.sources && typeof envValues.sources === "object"
    ? envValues.sources
    : {};
  const defaults = getRegistryDefaults(registryModels);
  const tiers = {};

  for (const tier of ["reasoning", "standard", "fast"]) {
    if (explicitSources[tier]) {
      tiers[tier] = {
        model: normalizedEnv[tier] ?? defaults[tier],
        source: explicitSources[tier],
      };
      continue;
    }

    if (normalizedEnv[tier]) {
      tiers[tier] = {
        model: normalizedEnv[tier],
        source: "env override",
      };
      continue;
    }

    tiers[tier] = {
      model: defaults[tier],
      source: registryModels[tier] ? "registry default" : "built-in default",
    };
  }

  return tiers;
}

export function selectModelTierForWorkCategory(workCategory = "") {
  return MODEL_TIER_BY_WORK_CATEGORY[workCategory] ?? null;
}

export function resolveExecutionContractModelMetadata({
  envValues = {},
  registryModels = {},
  requestedTier = null,
  workCategory = null,
} = {}) {
  const tiers = resolveTierAssignments(envValues, registryModels);
  const selectedTier = requestedTier ?? selectModelTierForWorkCategory(workCategory);
  const selected = selectedTier ? tiers[selectedTier] : null;

  return {
    version: "v1",
    workCategory: workCategory ?? null,
    requestedTier: requestedTier ?? null,
    selectedTier: selectedTier ?? null,
    selectedModel: selected?.model ?? null,
    selectedModelSource: selected?.source ?? null,
    tiers,
  };
}

/**
 * Check if a model ID ends with `:free`.
 * @param {string} modelId – Model identifier.
 * @returns {boolean} – True if the model is marked as free.
 */
function isFreeModel(modelId = "") {
  return /:free$/i.test(modelId);
}

/**
 * Choose a free model when multiple candidates exist.
 * Preference order: explicit primary > fallback > registry default > builtin default.
 * @param {string} primary – Explicitly selected model.
 * @param {string} fallback – Second‑choice candidate.
 * @param {string} registryDefault – Default from registry.
 * @param {string} builtinDefault – Built‑in fallback.
 * @returns {string|null} – The chosen model ID, or `null` if none selected.
 */
function preferFreeValue(
  primary,
  fallback,
  registryDefault,
  builtinDefault
) {
  if (primary && isFreeModel(primary)) return primary;
  if (fallback && isFreeModel(fallback)) return fallback;
  if (registryDefault && isFreeModel(registryDefault))
    return registryDefault;
  if (builtinDefault && isFreeModel(builtinDefault))
    return builtinDefault;
  return primary ?? fallback ?? registryDefault ?? builtinDefault ?? null;
}

/**
 * Infer tier‑specific models from a user‑selected model.
 * @param {string} selectedModel – Model explicitly chosen by the user.
 * @param {{registryModels:object,existing:object}} [options] – Context objects.
 * @returns {{reasoning:string,standard:string,fast:string}|null} – Inferred tier assignments.
 */
export function inferTierModelsFromSelection(
  selectedModel,
  { registryModels = {}, existing = {} } = {}
) {
  if (!selectedModel) return null;
  const family = matchProviderFamily(selectedModel);
  if (!family) return null;

  const registryDefaults = getRegistryDefaults(registryModels);
  const current = {
    reasoning: existing.reasoning ?? null,
    standard: existing.standard ?? null,
    fast: existing.fast ?? null,
  };

  const seeded = {
    reasoning: current.reasoning === selectedModel ? selectedModel : current.reasoning,
    standard: current.standard === selectedModel ? selectedModel : current.standard,
    fast: current.fast === selectedModel ? selectedModel : current.fast,
  };

  const derived = family.resolve(seeded);
  return {
    reasoning: derived.reasoning ?? registryDefaults.reasoning,
    standard: derived.standard ?? registryDefaults.standard,
    fast: derived.fast ?? registryDefaults.fast,
  };
}

/**
 * Apply a global “prefer‑free” preference to an existing tier set.
 * @param {{reasoning:string,standard:string,fast:string}} tierSet – Current tier assignments.
 * @param {{registryModels:object}} [options] – Registry context.
 * @returns {{reasoning:string,standard:string,fast:string}} – Updated tier set.
 */
export function applyFreePreferenceToTierSet(tierSet, { registryModels = {} } = {}) {
  const defaults = getRegistryDefaults(registryModels);
  return {
    reasoning: preferFreeValue(
      tierSet.reasoning,
      tierSet.standard,
      defaults.reasoning,
      BUILTIN_DEFAULTS.reasoning
    ),
    standard: preferFreeValue(
      tierSet.standard,
      tierSet.fast,
      defaults.standard,
      BUILTIN_DEFAULTS.standard
    ),
    fast: preferFreeValue(
      tierSet.fast,
      tierSet.standard,
      defaults.fast,
      BUILTIN_DEFAULTS.fast
    ),
  };
}

/**
 * Apply “prefer‑free‑same‑family” logic to a tier set based on an explicit
 * model selection. Only swaps a tier to a free sibling if that sibling stays
 * within the same provider family.
 * @param {{reasoning:string,standard:string,fast:string}} tierSet – Current assignments.
 * @param {string} selectedModel – Explicitly selected model ID.
 * @returns {{reasoning:string,standard:string,fast:string}} – Updated tier set.
 */
export function applyFreeSameFamilyPreferenceToTierSet(
  tierSet,
  selectedModel
) {
  const family = matchProviderFamily(selectedModel);
  if (!family) return tierSet;

  const sameFamily = family.resolve({ reasoning: null, standard: null, fast: null });

  const next = { ...tierSet };
  for (const tier of ["reasoning", "standard", "fast"]) {
    if (tierSet[tier] === selectedModel) continue;
    const candidate = sameFamily[tier];
    if (candidate && isFreeModel(candidate)) next[tier] = candidate;
  }
  return next;
}

/**
 * Select the best free model for a given tier from an array of free models.
 * Falls back to a registry‑provided fallback chain if no suitable free model exists.
 * @param {Array} freeModels – Output of `pollFreeModels`.
 * @param {"reasoning"|"standard"|"fast"} tier – Target tier.
 * @param {string[]} [registryFallbacks=[]] – Ordered list of fallback IDs.
 * @returns {string|null} – Best model ID, or `null` if none found.
 */
export function selectForTier(freeModels, tier, registryFallbacks = []) {
  const minContext = tier === "fast" ? 8_000 : tier === "standard" ? 16_000 : 32_000;

  if (freeModels && freeModels.length > 0) {
    const candidates = freeModels
      .filter((m) => m.contextLength >= minContext)
      .map((m) => ({ ...m, tierScore: _score(m, tier) }))
      .sort((a, b) => b.tierScore - a.tierScore);

    if (candidates[0]?.id) return candidates[0].id;
  }

  // No suitable free model found – walk the registry fallback chain
  return registryFallbacks[0] ?? null;
}

/**
 * Return the top N candidates for a given tier (used for UI lists).
 * @param {Array} freeModels – Array of model objects.
 * @param {"reasoning"|"standard"|"fast"} tier – Target tier.
 * @param {number} n – Number of candidates to return (default = 3).
 * @returns {Array} – Sorted candidate objects.
 */
export function topForTier(freeModels, tier, n = 3) {
  if (!freeModels || freeModels.length === 0) return [];

  const minContext = tier === "fast" ? 8_000 : tier === "standard" ? 16_000 : 32_000;
  return freeModels
    .filter((m) => m.contextLength >= minContext)
    .map((m) => ({ ...m, tierScore: _score(m, tier) }))
    .sort((a, b) => b.tierScore - a.tierScore)
    .slice(0, n);
}

/**
 * Persist CX_MODEL_* assignments into a .env file.
 *   • Removes any existing comment block that was generated by `--apply`.
 *   • Inserts a fresh comment with the current date.
 *   • Writes the new CX_MODEL_* lines at the top of the file (or appends if the file only contains comments).
 *
 * @param {string} envPath – Path to the .env file.
 * @param {{reasoning?:string,standard?:string,fast?:string}} selections – Model IDs to store.
 */
export function applyToEnv(envPath, selections) {
  const existing = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
  const date = new Date().toISOString().slice(0, 10);
  const commentMarker = "# Auto-set by construct models --apply on";

  const tierMap = {
    reasoning: "CX_MODEL_REASONING",
    standard: "CX_MODEL_STANDARD",
    fast: "CX_MODEL_FAST",
  };

  // Strip out any old auto‑generated block
  let lines = existing.split("\n");
  lines = lines.filter((l) => {
    const trimmed = l.trim();
    if (trimmed.startsWith(commentMarker)) return false;
    const key = trimmed.split("=")[0];
    if (Object.values(tierMap).includes(key)) return false;
    return true;
  });

  // Build the new comment + model lines
  const modelLines = [`${commentMarker} ${date}`];
  for (const [tier, envKey] of Object.entries(tierMap)) {
    if (selections[tier]) {
      modelLines.push(`${envKey}=${selections[tier]}`);
    }
  }

  // Insert just before the first blank line (or at EOF)
  const insertIdx = lines.findLastIndex((l) => l.trim() !== "") + 1;
  lines.splice(
    insertIdx === 0 ? lines.length : insertIdx,
    0,
    "",
    ...modelLines
  );

  fs.writeFileSync(envPath, lines.join("\n"));
}

/**
 * Remove all CX_MODEL_* entries and their associated comment from a .env file.
 * @param {string} envPath – Path to the .env file.
 */
export function resetEnv(envPath) {
  if (!fs.existsSync(envPath)) return;
  const commentMarker = "# Auto-set by construct models --apply on";
  const tierKeys = new Set([
    "CX_MODEL_REASONING",
    "CX_MODEL_STANDARD",
    "CX_MODEL_FAST",
  ]);

  const lines = fs.readFileSync(envPath, "utf8").split("\n");
  const filtered = lines.filter((l) => {
    const trimmed = l.trim();
    if (trimmed.startsWith(commentMarker)) return false;
    const key = trimmed.split("=")[0];
    if (tierKeys.has(key)) return false;
    return true;
  });

  fs.writeFileSync(envPath, filtered.join("\n"));
}

/**
 * Set a single tier’s model in the .env file.
 * @param {string} envPath – Path to the .env file.
 * @param {"reasoning"|"standard"|"fast"} tier – Target tier.
 * @param {string} modelId – Model identifier to store.
 */
export function setTierModel(envPath, tier, modelId) {
  applyToEnv(envPath, { [tier]: modelId });
}

/**
 * Replace an existing model selection with a new one, applying any
 * preference‑override flags (`preferFreeSameFamily` or `preferFree`).
 *
 *   applyToEnv() → writes the updated assignments.
 *
 * @param {string} envPath – Path to the .env file.
 * @param {"reasoning"|"standard"|"fast"} tier – Tier whose model should be set.
 * @param {string} modelId – New model ID.
 * @param {{registryModels:object,existing:object}} [context] – Additional context objects.
 * @param {object} [options] – Preference flags.
 * @returns {object} – The resolved tier assignments after overrides.
 */
export function setModelWithTierInference(
  envPath,
  tier,
  modelId,
  registryModels = {},
  options = {}
) {
  const existing = readEnvAssignments(envPath);
  existing[tier] = modelId;
  const inferred = inferTierModelsFromSelection(modelId, {
    registryModels,
    existing,
  }) || existing;
  inferred[tier] = modelId;

  let resolved = inferred;
  if (options.preferFreeSameFamily) {
    resolved = applyFreeSameFamilyPreferenceToTierSet(resolved, modelId);
  } else if (options.preferFree) {
    resolved = applyFreePreferenceToTierSet(resolved, { registryModels });
  }
  resolved[tier] = modelId;
  applyToEnv(envPath, resolved);
  return resolved;
}

/**
 * Read current model assignments from .env, falling back to registry defaults.
 * Provides a source‑tracking map for debugging.
 * @param {string} envPath – Path to the .env file.
 * @param {{reasoning:any,standard:any,fast:any}} registryModels – Reference data.
 * @returns {{reasoning:string,standard:string,fast:string,sources:Record<string,string>>}
 */
export function readCurrentModels(envPath, registryModels = {}) {
  const envValues = arguments.length > 2 ? arguments[2] : {};
  const fileAssignments = readEnvAssignments(envPath);
  const mergedAssignments = {
    ...fileAssignments,
    ...Object.fromEntries(
      Object.entries(normalizeEnvAssignments(envValues)).filter(([, value]) => value)
    ),
  };
  const tiers = resolveTierAssignments(mergedAssignments, registryModels);
  const result = { sources: {} };
  for (const tier of ["reasoning", "standard", "fast"]) {
    result[tier] = tiers[tier].model;
    result.sources[tier] = tiers[tier].source;
  }
  return result;
}
