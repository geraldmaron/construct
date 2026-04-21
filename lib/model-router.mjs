/**
 * lib/model-router.mjs — Central model routing and selection logic.
 *
 * What it does:
 *   • Defines provider-family tier mappings and resolves model IDs.
 *   • Provides helpers to apply free-preference modes (global, same-family,
 *     explicit selection) and to persist selections to .env.
 *   • Re-exports free-model polling and scoring from model-free-selector.mjs.
 *
 * Consumed by:
 *   • bin/construct          – model configuration commands.
 *   • lib/prompt-composer.mjs – execution contract metadata.
 *   • lib/mcp/server.mjs     – runtime model resolution.
 *   • lib/setup.mjs          – environment variable generation.
 *
 * Maintenance:
 *   • Adding new provider families → extend `PROVIDER_FAMILY_TIERS`.
 *   • Changing scoring logic → modify `score()` in model-free-selector.mjs.
 *   • Persisting selections → update `applyToEnv()`.
 */
import fs from "node:fs";
import path from "node:path";
import { findOpenCodeConfigPath } from "./opencode-config.mjs";
import {
  isFreeModel,
  pollFreeModels,
  preferFreeValue,
  selectForTier,
  topForTier,
} from "./model-free-selector.mjs";

// Re-export free-model utilities for backward compatibility.
export { isFreeModel, pollFreeModels, preferFreeValue, selectForTier, topForTier };

/**
 * Built-in default model IDs for each tier when no overrides are present.
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
 * Provider-family definitions. Each entry contains:
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
 * Find the provider-family entry that matches a given model identifier.
 */
function matchProviderFamily(modelId) {
  return PROVIDER_FAMILY_TIERS.find((entry) => entry.test(modelId));
}

/**
 * Given a primary model the user selected, return tier -> modelId mapping in
 * the same provider family. Returns null if no family matches.
 */
export function resolveTiersForPrimary(primaryModelId) {
  if (!primaryModelId || typeof primaryModelId !== "string") return null;
  const family = matchProviderFamily(primaryModelId);
  if (!family) return null;
  return family.resolve({ reasoning: undefined, standard: undefined, fast: undefined });
}

/**
 * Read the OpenRouter API key from the OpenCode config file.
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

// --- Internal helpers ---

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

function extractPrimary(def) {
  if (typeof def === "string") return def;
  if (def && typeof def === "object")
    return def.primary ?? def.fallback?.[0] ?? null;
  return null;
}

function getRegistryDefaults(registryModels = {}) {
  return {
    reasoning: extractPrimary(registryModels.reasoning) ?? BUILTIN_DEFAULTS.reasoning,
    standard: extractPrimary(registryModels.standard) ?? BUILTIN_DEFAULTS.standard,
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

// --- Public API ---

export function classifyProviderFailure(input) {
  const error = input?.error && typeof input.error === "object" ? input.error : input;
  const text = flattenText([
    error?.message, error?.name, error?.code,
    error?.status, error?.statusCode,
    input?.message, input?.error,
  ]);
  if (!text) return null;

  const provider = [
    error?.provider, input?.provider, input?.model?.provider, input?.session?.provider,
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
      return { kind: pattern.kind, provider, retryable: pattern.retryable };
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

  const candidates = [tierDef.primary, ...tierDef.fallback]
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

  return { action: "apply-models", reason: classified.kind, targetModel, tier };
}

function resolveTierAssignments(envValues = {}, registryModels = {}) {
  const normalizedEnv = normalizeEnvAssignments(envValues);
  const explicitSources = envValues?.sources && typeof envValues.sources === "object" ? envValues.sources : {};
  const defaults = getRegistryDefaults(registryModels);
  const tiers = {};

  for (const tier of ["reasoning", "standard", "fast"]) {
    if (explicitSources[tier]) {
      tiers[tier] = { model: normalizedEnv[tier] ?? defaults[tier], source: explicitSources[tier] };
    } else if (normalizedEnv[tier]) {
      tiers[tier] = { model: normalizedEnv[tier], source: "env override" };
    } else {
      tiers[tier] = { model: defaults[tier], source: registryModels[tier] ? "registry default" : "built-in default" };
    }
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

export function applyFreePreferenceToTierSet(tierSet, { registryModels = {} } = {}) {
  const defaults = getRegistryDefaults(registryModels);
  return {
    reasoning: preferFreeValue(tierSet.reasoning, tierSet.standard, defaults.reasoning, BUILTIN_DEFAULTS.reasoning),
    standard: preferFreeValue(tierSet.standard, tierSet.fast, defaults.standard, BUILTIN_DEFAULTS.standard),
    fast: preferFreeValue(tierSet.fast, tierSet.standard, defaults.fast, BUILTIN_DEFAULTS.fast),
  };
}

export function applyFreeSameFamilyPreferenceToTierSet(tierSet, selectedModel) {
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

export function applyToEnv(envPath, selections) {
  const existing = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
  const date = new Date().toISOString().slice(0, 10);
  const commentMarker = "# Auto-set by construct models --apply on";

  const tierMap = {
    reasoning: "CX_MODEL_REASONING",
    standard: "CX_MODEL_STANDARD",
    fast: "CX_MODEL_FAST",
  };

  let lines = existing.split("\n");
  lines = lines.filter((l) => {
    const trimmed = l.trim();
    if (trimmed.startsWith(commentMarker)) return false;
    const key = trimmed.split("=")[0];
    if (Object.values(tierMap).includes(key)) return false;
    return true;
  });

  const modelLines = [`${commentMarker} ${date}`];
  for (const [tier, envKey] of Object.entries(tierMap)) {
    if (selections[tier]) modelLines.push(`${envKey}=${selections[tier]}`);
  }

  const insertIdx = lines.findLastIndex((l) => l.trim() !== "") + 1;
  lines.splice(insertIdx === 0 ? lines.length : insertIdx, 0, "", ...modelLines);

  fs.writeFileSync(envPath, lines.join("\n"));
}

export function resetEnv(envPath) {
  if (!fs.existsSync(envPath)) return;
  const commentMarker = "# Auto-set by construct models --apply on";
  const tierKeys = new Set(["CX_MODEL_REASONING", "CX_MODEL_STANDARD", "CX_MODEL_FAST"]);

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

export function setTierModel(envPath, tier, modelId) {
  applyToEnv(envPath, { [tier]: modelId });
}

export function setModelWithTierInference(envPath, tier, modelId, registryModels = {}, options = {}) {
  const existing = readEnvAssignments(envPath);
  existing[tier] = modelId;
  const inferred = inferTierModelsFromSelection(modelId, { registryModels, existing }) || existing;
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
