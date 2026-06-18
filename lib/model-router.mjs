/**
 * lib/model-router.mjs — Central model routing and selection logic.
 *
 * What it does:
 *   • Defines provider-family tier mappings and resolves model IDs.
 *   • Provides helpers to apply free-preference modes (global, same-family,
 *     explicit selection) and to persist selections to .env.
 *   • Provider-aware failover: classifies failures, resolves fallback candidates,
 *     and tracks per-provider cooldowns in ~/.cx/provider-cooldowns.json.
 *
 * Consumed by:
 *   • bin/construct                  – model configuration commands.
 *   • lib/prompt-composer.js        – execution contract metadata.
 *   • lib/mcp/server.mjs             – runtime model resolution.
 *   • lib/setup.mjs                  – environment variable generation.
 *   • lib/hooks/model-fallback.mjs   – automatic failover on rate-limit / outage.
 *
 * Maintenance:
 *   • Adding new provider families → extend `PROVIDER_FAMILY_TIERS`.
 *   • Changing scoring logic → modify `score()` in model-free-selector.mjs.
 *   • Persisting selections → update `applyToEnv()`.
 *   • Cooldown window → change `PROVIDER_COOLDOWN_MS`.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "child_process";
import { hasAnySecret } from "./providers/secret-resolver.mjs";
import { findOpenCodeConfigPath } from "./opencode-config.mjs";
import { isLocalModel } from "./mcp/tool-budget.mjs";
import {
  isFreeModel,
  pollFreeModels,
  preferFreeValue,
  selectForTier,
  topForTier,
} from "./model-free-selector.mjs";

function uniqueStrings(values = []) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.trim()))];
}

export const MODEL_TIER_BY_WORK_CATEGORY = {
  visual: "standard",
  deep: "reasoning",
  quick: "fast",
  writing: "fast",
  analysis: "standard",
};

export const MODEL_OPERATING_PROFILES = Object.freeze({
  balanced: {
    id: 'balanced',
    label: 'Balanced',
    maxPromptTokens: 3000,
    learnedPatternsTokens: 200,
    taskPacketTokens: 150,
    contextDigestTokens: 200,
    hostConstraintsTokens: 75,
    roleFlavorTokens: 600,
    retrievalFirst: false,
    preferCompressedRoleGuidance: false,
  },
  small: {
    id: 'small',
    label: 'Small-model',
    maxPromptTokens: 1800,
    learnedPatternsTokens: 120,
    taskPacketTokens: 110,
    contextDigestTokens: 120,
    hostConstraintsTokens: 40,
    roleFlavorTokens: 280,
    retrievalFirst: true,
    preferCompressedRoleGuidance: true,
  },
});

function normalizeModelOperatingProfile(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === 'default') return 'balanced';
  return MODEL_OPERATING_PROFILES[normalized] ? normalized : null;
}

function parseModelSizeB(model) {
  const size = String(model || "").toLowerCase().match(/(?:[:/-])(\d+(?:\.\d+)?)b\b/);
  return size ? parseFloat(size[1]) : null;
}

function inferSmallModelProfile(selectedModel) {
  const model = String(selectedModel || '').toLowerCase();
  if (!model) return false;
  // Match any parameter-count marker (7b, 24b, 30b, 32b, …) rather than a fixed list —
  // the old list silently missed 24b/30b, so Devstral-24B and qwen3-coder-30B resolved
  // to the balanced profile. Treat <=34B local models as small.
  if (/^(ollama|local)\//.test(model)) {
    const size = parseModelSizeB(model);
    if (size !== null && size <= 34) return true;
  }
  if (/^(anthropic|openrouter\/anthropic)\/.*haiku/.test(model)) return true;
  if (/gpt-5\.1-mini|gemma-3|gemma-4|phi3:mini/.test(model)) return true;
  return false;
}

export function resolveModelOperatingProfile({
  envValues = {},
  selectedModel = null,
} = {}) {
  const explicit = normalizeModelOperatingProfile(
    envValues.CONSTRUCT_MODEL_PROFILE ?? envValues.constructModelProfile
  );
  if (explicit) return MODEL_OPERATING_PROFILES[explicit];
  if (inferSmallModelProfile(selectedModel)) return MODEL_OPERATING_PROFILES.small;
  return MODEL_OPERATING_PROFILES.balanced;
}

// Small local models follow large multi-instruction prompts poorly; the binding
// constraint is instruction-following capacity, not the token window (which the cx32k
// Modelfile variants already widen). Map a model to the persona section tier it can
// comply with — floor (must-keep only), mid, or full. A COLLAPSED probe verdict forces
// floor; otherwise local size estimates the tier and any cloud model gets the full
// persona, so cloud configs are never slimmed.

export function resolveCapabilityTier({ model, verdict = null } = {}) {
  if (!isLocalModel(model)) return 'full';
  if (verdict === 'COLLAPSED') return 'floor';
  const size = parseModelSizeB(model);
  if (size === null) return 'floor';
  if (size >= 24) return 'mid';
  return 'floor';
}

const CODE_MODEL_RE = /coder|codellama|starcoder|deepseek-coder|devstral/i;

// Pick the model for the narrow local editor (construct-local) from the DECLARED local
// inventory rather than the generic fast-tier default (which, for an Ollama family,
// resolves to a non-code generalist like llama3.2:3b). The editor does bounded code
// edits, so prefer a code-specialized model in the reliable size band [7,34]B (smallest =
// cheapest competent editor), then the smallest code model, then the smallest local model
// of any kind. Candidates should already exclude probe-COLLAPSED models. Returns null only
// when there are no candidates, so the caller keeps its own fallback.

export function selectLocalEditorModel(candidates = []) {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  const sized = candidates.map((m) => ({ m, size: parseModelSizeB(m) }));
  const pick = (arr) => {
    const band = arr.filter((x) => x.size !== null && x.size >= 7 && x.size <= 34).sort((a, b) => a.size - b.size);
    if (band.length) return band[0].m;
    const anySized = arr.filter((x) => x.size !== null).sort((a, b) => a.size - b.size);
    return anySized.length ? anySized[0].m : arr[0].m;
  };
  const coders = sized.filter((x) => CODE_MODEL_RE.test(x.m));
  return coders.length ? pick(coders) : pick(sized);
}

/**
 * Provider-family definitions. Each entry contains:
 *   - `test`: RegExp that matches provider URLs.
 *   - `resolve`: Function that maps selected tier values to concrete model IDs.
 *
 * Families are consulted in order; the first match wins.
 */
const PROVIDER_FAMILY_TIERS = [
  {
    id: 'anthropic',
    label: 'Anthropic (direct)',
    test: (modelId) => /^anthropic\//.test(modelId),
    resolve: ({ reasoning, standard, fast }) => ({
      reasoning: reasoning ?? "anthropic/claude-opus-4-6",
      standard: standard ?? "anthropic/claude-sonnet-4-6",
      fast: fast ?? "anthropic/claude-haiku-4-5-20251001",
    }),
    options: {
      reasoning: ["anthropic/claude-opus-4-6", "anthropic/claude-sonnet-4-6"],
      standard: ["anthropic/claude-sonnet-4-6", "anthropic/claude-opus-4-6"],
      fast: ["anthropic/claude-haiku-4-5-20251001", "anthropic/claude-sonnet-4-6"],
    },
  },
  {
    id: 'openrouter-anthropic',
    label: 'Anthropic via OpenRouter',
    test: (modelId) => /^openrouter\/anthropic\//.test(modelId),
    resolve: ({ reasoning, standard, fast }) => ({
      reasoning: reasoning ?? "openrouter/anthropic/claude-opus-4-6",
      standard: standard ?? "openrouter/anthropic/claude-sonnet-4-6",
      fast: fast ?? "openrouter/anthropic/claude-haiku-4-5-20251001",
    }),
    options: {
      reasoning: ["openrouter/anthropic/claude-opus-4-6", "openrouter/anthropic/claude-sonnet-4-6"],
      standard: ["openrouter/anthropic/claude-sonnet-4-6", "openrouter/anthropic/claude-opus-4-6"],
      fast: ["openrouter/anthropic/claude-haiku-4-5-20251001", "openrouter/anthropic/claude-sonnet-4-6"],
    },
  },
  {
    id: 'openrouter-google',
    label: 'Google via OpenRouter',
    test: (modelId) => /^openrouter\/google\//.test(modelId),
    resolve: ({ reasoning, standard, fast }) => ({
      reasoning: reasoning ?? "openrouter/google/gemini-2.5-pro",
      standard: standard ?? "openrouter/google/gemini-2.0-flash-001",
      fast: fast ?? "openrouter/google/gemma-3-27b-it:free",
    }),
    options: {
      reasoning: ["openrouter/google/gemini-2.5-pro", "openrouter/google/gemini-2.5-flash"],
      standard: ["openrouter/google/gemini-2.0-flash-001", "openrouter/google/gemini-2.5-flash"],
      fast: ["openrouter/google/gemma-3-27b-it:free", "openrouter/google/gemini-2.0-flash-001"],
    },
  },
  {
    id: 'openrouter-deepseek',
    label: 'DeepSeek via OpenRouter',
    test: (modelId) => /^openrouter\/deepseek\//.test(modelId),
    resolve: ({ reasoning, standard, fast }) => ({
      reasoning: reasoning ?? "openrouter/deepseek/deepseek-r1",
      standard: standard ?? "openrouter/deepseek/deepseek-v3",
      fast: fast ?? standard ?? "openrouter/qwen/qwen3-coder:free",
    }),
    options: {
      reasoning: ["openrouter/deepseek/deepseek-r1", "openrouter/deepseek/deepseek-v3"],
      standard: ["openrouter/deepseek/deepseek-v3", "openrouter/deepseek/deepseek-r1"],
      fast: ["openrouter/qwen/qwen3-coder:free", "openrouter/deepseek/deepseek-v3"],
    },
  },
  {
    id: 'openrouter-qwen',
    label: 'Qwen via OpenRouter',
    test: (modelId) => /^openrouter\/qwen\//.test(modelId),
    resolve: ({ reasoning, standard, fast }) => ({
      reasoning: reasoning ?? "openrouter/qwen/qwen3-coder",
      standard: standard ?? "openrouter/qwen/qwen3-coder:free",
      fast: fast ?? "openrouter/qwen/qwen2.5-coder-32b-instruct",
    }),
    options: {
      reasoning: ["openrouter/qwen/qwen3-coder", "openrouter/qwen/qwen3-coder:free"],
      standard: ["openrouter/qwen/qwen3-coder:free", "openrouter/qwen/qwen3-coder"],
      fast: ["openrouter/qwen/qwen2.5-coder-32b-instruct", "openrouter/qwen/qwen3-coder:free"],
    },
  },
  {
    id: 'github-copilot',
    label: 'GitHub Copilot',
    test: (modelId) => /^github-copilot\//.test(modelId),
    resolve: ({ reasoning, standard, fast }) => ({
      reasoning: reasoning ?? "github-copilot/gpt-5.5",
      standard: standard ?? "github-copilot/gpt-5.4",
      fast: fast ?? "github-copilot/gpt-5.4-mini",
    }),
    options: {
      reasoning: ["github-copilot/gpt-5.5", "github-copilot/gpt-5.4", "github-copilot/claude-opus-4.8"],
      standard: ["github-copilot/gpt-5.4", "github-copilot/gpt-4o", "github-copilot/claude-sonnet-4.6"],
      fast: ["github-copilot/gpt-5.4-mini", "github-copilot/gpt-4o-mini"],
    },
  },
  {
    id: 'openai',
    label: 'OpenAI',
    test: (modelId) => /^openai\//.test(modelId) || /^openrouter\/openai\//.test(modelId),
    resolve: ({ reasoning, standard, fast }) => {
      const prefix = /^openrouter\//.test(reasoning || standard || fast || "") ? "openrouter/openai" : "openai";
      return {
        reasoning: reasoning ?? `${prefix}/gpt-5.4`,
        standard: standard ?? `${prefix}/gpt-5.1`,
        fast: fast ?? `${prefix}/gpt-5.1-mini`,
      };
    },
    options: {
      reasoning: ["openai/gpt-5.4", "openrouter/openai/gpt-5.4", "openai/gpt-5.1"],
      standard: ["openai/gpt-5.1", "openrouter/openai/gpt-5.1", "openai/gpt-5.1-mini"],
      fast: ["openai/gpt-5.1-mini", "openrouter/openai/gpt-5.1-mini", "openai/gpt-5.1"],
    },
  },
  {
    id: 'openrouter-llama',
    label: 'Meta Llama via OpenRouter',
    test: (modelId) => /^openrouter\/meta-llama\//.test(modelId),
    resolve: ({ reasoning, standard, fast }) => ({
      reasoning: reasoning ?? "openrouter/meta-llama/llama-3.1-405b-instruct",
      standard: standard ?? "openrouter/meta-llama/llama-3.3-70b-instruct",
      fast: fast ?? "openrouter/meta-llama/llama-3.3-70b-instruct:free",
    }),
    options: {
      reasoning: ["openrouter/meta-llama/llama-3.1-405b-instruct", "openrouter/meta-llama/llama-3.3-70b-instruct"],
      standard: ["openrouter/meta-llama/llama-3.3-70b-instruct", "openrouter/meta-llama/llama-3.3-70b-instruct:free"],
      fast: ["openrouter/meta-llama/llama-3.3-70b-instruct:free", "openrouter/meta-llama/llama-3.3-70b-instruct"],
    },
  },
  {
    id: 'ollama',
    label: 'Ollama (local)',
    test: (modelId) => /^ollama\//.test(modelId),
    resolve: ({ reasoning, standard, fast }) => ({
      reasoning: reasoning ?? "ollama/llama3.1:70b",
      standard: standard ?? "ollama/llama3.1:8b",
      fast: fast ?? "ollama/llama3.2:3b",
    }),
    options: {
      reasoning: ["ollama/llama3.1:70b", "ollama/qwen2.5:32b", "ollama/deepseek-r1:32b"],
      standard: ["ollama/llama3.1:8b", "ollama/qwen2.5:7b", "ollama/mistral:7b"],
      fast: ["ollama/llama3.2:3b", "ollama/phi3:mini", "ollama/qwen2.5:3b"],
    },
    local: true,
    requiresEnv: ['OLLAMA_BASE_URL'],
    pricingHint: 'free · runs locally',
  },
  {
    id: 'local',
    label: 'Local OpenAI-compatible server',
    test: (modelId) => /^local\//.test(modelId),
    resolve: ({ reasoning, standard, fast }) => ({
      reasoning: reasoning ?? "local/custom-large",
      standard: standard ?? "local/custom-medium",
      fast: fast ?? "local/custom-small",
    }),
    options: {
      reasoning: ["local/custom-large"],
      standard: ["local/custom-medium"],
      fast: ["local/custom-small"],
    },
    local: true,
    requiresEnv: ['LOCAL_LLM_BASE_URL'],
    pricingHint: 'free · runs locally',
  },
];

export { PROVIDER_FAMILY_TIERS };

/**
 * Maps provider family IDs to the env var(s) that confirm credentials are present.
 * Consumed by getProviderModelCatalog to mark which providers are available.
 */
const PROVIDER_ENV_MAP = {
  'anthropic': ['ANTHROPIC_API_KEY'],
  'openrouter-anthropic': ['OPENROUTER_API_KEY', 'OPEN_ROUTER_API_KEY'],
  'openrouter-google': ['OPENROUTER_API_KEY', 'OPEN_ROUTER_API_KEY'],
  'openrouter-deepseek': ['OPENROUTER_API_KEY', 'OPEN_ROUTER_API_KEY'],
  'openrouter-qwen': ['OPENROUTER_API_KEY', 'OPEN_ROUTER_API_KEY'],
  'github-copilot': ['GITHUB_TOKEN', 'GH_TOKEN'],
  'openai': ['OPENAI_API_KEY'],
  'openrouter-llama': ['OPENROUTER_API_KEY', 'OPEN_ROUTER_API_KEY'],
  'ollama': ['OLLAMA_BASE_URL', 'OLLAMA_HOST'],
  'local': ['LOCAL_LLM_BASE_URL'],
};

// A stored device-flow Copilot credential — Construct's own auth store or the
// standard ~/.config/github-copilot store other tools share — means Copilot is
// usable without a gh CLI session. Detection stays sync, file-only, and never
// performs the token exchange; copilot-auth.mjs owns read/write/refresh.

function hasCopilotCredential() {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  if (!home) return false;
  const candidates = [
    path.join(home, '.construct', 'auth', 'github-copilot.json'),
    path.join(home, '.config', 'github-copilot', 'apps.json'),
    path.join(home, '.config', 'github-copilot', 'hosts.json'),
  ];
  for (const file of candidates) {
    try {
      if (!fs.existsSync(file)) continue;
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (file.endsWith('github-copilot.json')) {
        if (data && (data.oauth_token || data.token || data.refresh_token || data.refresh)) return true;
      } else {
        for (const entry of Object.values(data || {})) {
          if (entry && (entry.oauth_token || entry.token)) return true;
        }
      }
    } catch { /* unreadable or non-JSON is not a usable credential */ }
  }
  return false;
}

/**
 * Check if a provider is configured by checking env vars and CLI tools.
 * Uses the passed env, dotenv files, shell rc, then the Copilot credential store
 * or gh CLI for Copilot. A stored op:// reference counts as configured.
 */
function isProviderConfigured(familyId, env) {
  const varNames = PROVIDER_ENV_MAP[familyId];
  if (!varNames?.length) return false;

  // Special case: Ollama on default port (no OLLAMA_BASE_URL needed)
  if (familyId === 'ollama') {
    try {
      const r = spawnSync('curl', ['-s', '--connect-timeout', '1', '-o', '/dev/null', '-w', '%{http_code}', 'http://localhost:11434/api/tags'], { encoding: 'utf8', timeout: 3000 });
      if (r.status === 0 && r.stdout?.trim() === '200') return true;
    } catch { /* not available */ }
    try {
      const r = spawnSync('ollama', ['--version'], { encoding: 'utf8', timeout: 2000 });
      if (r.status === 0) return true;
    } catch { /* not available */ }
  }

  // Any credential source counts — env, ~/.construct/config.env, ~/.env, the
  // project .env, and shell rc exports — and a stored 1Password op:// reference
  // counts as configured because the resolver reads it lazily at call time.
  if (hasAnySecret(varNames, { env })) return true;

  // GitHub Copilot authenticates via OAuth rather than an API key: a stored
  // device-flow credential, or a gh CLI session as a fallback, both count.
  if (familyId === 'github-copilot') {
    if (hasCopilotCredential()) return true;
    try {
      const r = spawnSync('gh', ['auth', 'status'], { encoding: 'utf8', timeout: 3000 });
      return r.status === 0;
    } catch { return false; }
  }

  return false;
}

export function getProviderModelCatalog({ env = process.env } = {}) {
  const providers = PROVIDER_FAMILY_TIERS.map((family) => {
    const tiers = family.resolve({});
    const options = {
      reasoning: uniqueStrings([...(family.options?.reasoning ?? []), tiers.reasoning]),
      standard: uniqueStrings([...(family.options?.standard ?? []), tiers.standard]),
      fast: uniqueStrings([...(family.options?.fast ?? []), tiers.fast]),
    };
    return {
      id: family.id,
      label: family.label,
      tiers,
      options,
      local: family.local === true,
      requiresEnv: Array.isArray(family.requiresEnv) ? family.requiresEnv : [],
      pricingHint: family.pricingHint ?? null,
      configured: isProviderConfigured(family.id, env),
    };
  });

  const tierOptions = {
    reasoning: uniqueStrings(providers.flatMap((provider) => provider.options.reasoning)),
    standard: uniqueStrings(providers.flatMap((provider) => provider.options.standard)),
    fast: uniqueStrings(providers.flatMap((provider) => provider.options.fast)),
  };

  return { providers, tierOptions };
}

// Provider families with open-ended model catalogs: credential presence is the
// gate; static option lists are hints, not exhaustive allowlists.

const LENIENT_MODEL_FAMILIES = new Set([
  'openrouter-anthropic',
  'openrouter-google',
  'openrouter-deepseek',
  'openrouter-qwen',
  'openrouter-llama',
  'openai',
  'anthropic',
  'ollama',
  'local',
]);

/**
 * Check whether a model id can be used on this machine right now: the provider
 * family must match, credentials must be present (including op:// and Copilot
 * auth-store), and for fixed-catalog families (e.g. github-copilot) the id must
 * appear in the shipped option list or tier defaults — not a stale CX_MODEL pin.
 */
export function isChatModelAvailable(modelId, { env = process.env, excludeFamilies = [] } = {}) {
  if (!modelId || typeof modelId !== 'string') {
    return { ok: false, reason: 'missing', modelId: modelId || null };
  }
  const family = matchProviderFamily(modelId);
  if (!family) {
    return { ok: false, reason: 'unknown_family', modelId };
  }
  if (excludeFamilies.includes(family.id)) {
    return { ok: false, reason: 'excluded', modelId, provider: family.id };
  }
  if (!isProviderConfigured(family.id, env)) {
    return { ok: false, reason: 'provider_not_configured', modelId, provider: family.id };
  }
  if (LENIENT_MODEL_FAMILIES.has(family.id)) {
    return { ok: true, modelId, provider: family.id };
  }
  const { providers } = getProviderModelCatalog({ env });
  const provider = providers.find((p) => p.id === family.id);
  if (!provider) {
    return { ok: false, reason: 'unknown_family', modelId };
  }
  const known = uniqueStrings([
    ...(provider.options?.reasoning ?? []),
    ...(provider.options?.standard ?? []),
    ...(provider.options?.fast ?? []),
    provider.tiers?.reasoning,
    provider.tiers?.standard,
    provider.tiers?.fast,
  ]);
  if (known.includes(modelId)) {
    return { ok: true, modelId, provider: family.id };
  }
  return { ok: false, reason: 'model_not_available', modelId, provider: family.id };
}

function availabilityNotice(rejected) {
  if (!rejected?.modelId) return null;
  const label = rejected.modelId;
  if (rejected.reason === 'provider_not_configured') {
    return `Pinned ${label} — provider not configured.`;
  }
  if (rejected.reason === 'model_not_available') {
    return `Pinned ${label} — not available on your account.`;
  }
  if (rejected.reason === 'unknown_family') {
    return `Pinned ${label} — unrecognized model id.`;
  }
  return `Pinned ${label} — unavailable.`;
}

function recommendTierModel(tier, { env = process.env, excludeFamilies = [] } = {}) {
  const { providers } = getProviderModelCatalog({ env });
  for (const provider of providers) {
    if (!provider.configured || excludeFamilies.includes(provider.id)) continue;
    const candidates = uniqueStrings([
      provider.tiers?.[tier],
      ...(provider.options?.[tier] ?? []),
    ]);
    for (const id of candidates) {
      const check = isChatModelAvailable(id, { env, excludeFamilies });
      if (check.ok) return { id, provider: provider.label, tier };
    }
  }
  return null;
}

/**
 * Resolve the chat model with validation: explicit request and CX_MODEL pins
 * are preferences, not blind truth. Stale or unconfigured pins fall through to
 * the next configured provider for the tier, with a human-readable notice.
 */
export function resolveValidatedChatModel({ env = process.env, requested = null, excludeFamilies = [] } = {}) {
  const rejections = [];

  if (requested) {
    const check = isChatModelAvailable(requested, { env, excludeFamilies });
    if (check.ok) {
      return { id: requested, source: 'explicit', notice: null, rejected: [] };
    }
    rejections.push(check);
  }

  const pinOrder = [
    ['standard', env.CX_MODEL_STANDARD],
    ['reasoning', env.CX_MODEL_REASONING],
    ['fast', env.CX_MODEL_FAST],
  ];
  for (const [tier, pin] of pinOrder) {
    if (!pin) continue;
    const check = isChatModelAvailable(pin, { env, excludeFamilies });
    if (check.ok) {
      const notice = rejections.length
        ? `${availabilityNotice(rejections[0])} Using ${pin}.`
        : null;
      return { id: pin, source: 'pin', tier, notice, rejected: rejections };
    }
    rejections.push(check);
  }

  const standard = recommendTierModel('standard', { env, excludeFamilies });
  if (standard) {
    const notice = rejections.length
      ? `${availabilityNotice(rejections[0])} Using ${standard.id} (${standard.provider}).`
      : null;
    return { id: standard.id, source: 'recommended', tier: 'standard', notice, rejected: rejections };
  }

  const anyTier = recommendTierModel('reasoning', { env, excludeFamilies }) || recommendTierModel('fast', { env, excludeFamilies });
  if (anyTier) {
    const notice = rejections.length
      ? `${availabilityNotice(rejections[0])} Using ${anyTier.id} (${anyTier.provider}).`
      : null;
    return { id: anyTier.id, source: 'recommended', tier: anyTier.tier, notice, rejected: rejections };
  }

  const notice = rejections.length ? availabilityNotice(rejections[0]) : null;
  return { id: null, source: null, notice, rejected: rejections };
}

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

// Credential detection here is env-only — no network or process probe — so
// callers (embedded model resolution, capability discovery) stay synchronous
// and deterministic, and never expose a key value, only its presence.

function familyDescriptor(family, env) {
  const requiresEnv = PROVIDER_ENV_MAP[family.id] || (Array.isArray(family.requiresEnv) ? family.requiresEnv : []);
  const local = family.local === true;
  const configured = isProviderConfigured(family.id, env);
  return {
    id: family.id,
    label: family.label,
    local,
    requiresEnv,
    tiers: family.resolve({}),
    configured,
  };
}

/**
 * Describe the provider family a model id belongs to, including which env keys
 * confirm credentials and whether they are present. Returns null when no family
 * matches.
 */
export function describeModelFamily(modelId, { env = process.env } = {}) {
  const family = matchProviderFamily(modelId);
  if (!family) return null;
  return familyDescriptor(family, env);
}

/**
 * Describe every provider family. Resolves a host-supplied provider id and
 * enumerates model availability for the embedded contract layer.
 */
export function listModelFamilies({ env = process.env } = {}) {
  return PROVIDER_FAMILY_TIERS.map((family) => familyDescriptor(family, env));
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
    reasoning: extractPrimary(registryModels.reasoning) ?? null,
    standard: extractPrimary(registryModels.standard) ?? null,
    fast: extractPrimary(registryModels.fast) ?? null,
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

// --- Provider cooldown helpers ---

const PROVIDER_COOLDOWN_MS = 5 * 60 * 1000;

/**
 * Read the per-provider cooldown state file.
 * Returns a map of providerKey → expiresAt timestamp.
 */
export function readProviderCooldowns(cooldownPath) {
  try {
    const raw = fs.readFileSync(cooldownPath, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
  } catch {
    // missing or corrupt — treat as empty
  }
  return {};
}

/**
 * Record a cooldown for a provider key, expiring after PROVIDER_COOLDOWN_MS.
 */
export function writeProviderCooldown(cooldownPath, provider, now = Date.now()) {
  if (!provider) return;
  const existing = readProviderCooldowns(cooldownPath);
  existing[provider] = now + PROVIDER_COOLDOWN_MS;
  fs.mkdirSync(path.dirname(cooldownPath), { recursive: true });
  fs.writeFileSync(cooldownPath, JSON.stringify(existing, null, 2));
}

/**
 * Return true if the given provider is still within its cooldown window.
 */
export function isProviderOnCooldown(cooldownPath, provider, now = Date.now()) {
  if (!provider) return false;
  const state = readProviderCooldowns(cooldownPath);
  const expiresAt = state[provider];
  return typeof expiresAt === "number" && now < expiresAt;
}

/**
 * High-level entry point for the fallback hook.
 *
 * Given raw hook input, current env path, and a cooldown file path:
 *   1. Classifies the failure.
 *   2. Resolves a candidate model from the tier's fallback list, skipping any
 *      provider currently on cooldown.
 *   3. Returns { targetModel, tier, reason } or null if nothing actionable.
 */
export function selectFallbackModel({
  hookInput,
  envPath,
  cooldownPath,
  registryModels = {},
  now = Date.now(),
} = {}) {
  const classified = classifyProviderFailure(hookInput);
  if (!classified || !classified.retryable) return null;

  const failingProvider = providerKey(classified.provider || "");
  if (failingProvider && isProviderOnCooldown(cooldownPath, failingProvider, now)) return null;

  const currentModels = readCurrentModels(envPath, registryModels);
  const action = resolveFallbackAction({
    failure: classified,
    currentModels,
    registryModels,
  });
  if (!action) return null;

  const candidateProvider = providerKey(action.targetModel);
  if (candidateProvider && isProviderOnCooldown(cooldownPath, candidateProvider, now)) return null;

  return { targetModel: action.targetModel, tier: action.tier, reason: action.reason };
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
    } else if (defaults[tier]) {
      tiers[tier] = { model: defaults[tier], source: "registry" };
    } else {
      tiers[tier] = { model: null, source: "not configured" };
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
  const profile = resolveModelOperatingProfile({
    envValues,
    selectedModel: selected?.model ?? null,
  });

  return {
    version: "v1",
    workCategory: workCategory ?? null,
    requestedTier: requestedTier ?? null,
    selectedTier: selectedTier ?? null,
    selectedModel: selected?.model ?? null,
    selectedModelSource: selected?.source ?? null,
    profile,
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
    reasoning: preferFreeValue(tierSet.reasoning, tierSet.standard, defaults.reasoning, null),
    standard: preferFreeValue(tierSet.standard, tierSet.fast, defaults.standard, null),
    fast: preferFreeValue(tierSet.fast, tierSet.standard, defaults.fast, null),
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

export { resolveProviderCapabilities } from './provider-capabilities.js';
export { resolveProviderCapabilitiesSync } from './provider-capabilities.js';
