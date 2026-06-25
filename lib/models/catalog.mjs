/**
 * lib/models/catalog.mjs — live model catalog merge, cache, and visibility filter.
 *
 * Merges static provider-family hints with cached OpenRouter free-model polls,
 * then applies construct.config.json models.visibility rules so chat, CLI, and
 * dashboard share one filtered catalog surface.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pollFreeModels } from '../model-free-selector.mjs';
import { resolveFirstSecret } from '../providers/secret-resolver.mjs';
import { loadProjectConfig } from '../config/project-config.mjs';
import { doctorRoot } from '../config/xdg.mjs';

export const MODEL_VISIBILITY_MODES = ['all_configured', 'tier_defaults', 'explicit'];

export const DEFAULT_MODELS_CONFIG = Object.freeze({
  visibility: Object.freeze({
    mode: 'all_configured',
    include: [],
    exclude: [],
    providers: {},
  }),
  catalog: Object.freeze({
    liveOpenRouter: true,
    maxLiveFree: 24,
  }),
});

const CACHE_FILENAME = 'model-catalog-cache.json';
const CACHE_TTL_MS = 10 * 60 * 1000;

function uniqueStrings(values = []) {
  return [...new Set(values.filter((value) => typeof value === 'string' && value.trim()))];
}

function cachePath(homeDir = os.homedir()) {
  return path.join(doctorRoot(homeDir), CACHE_FILENAME);
}

export function resolveModelsConfig(projectConfig = {}) {
  const models = projectConfig?.models && typeof projectConfig.models === 'object'
    ? projectConfig.models
    : {};
  const visibility = { ...DEFAULT_MODELS_CONFIG.visibility, ...(models.visibility || {}) };
  const catalog = { ...DEFAULT_MODELS_CONFIG.catalog, ...(models.catalog || {}) };
  if (!MODEL_VISIBILITY_MODES.includes(visibility.mode)) {
    visibility.mode = DEFAULT_MODELS_CONFIG.visibility.mode;
  }
  visibility.include = Array.isArray(visibility.include) ? visibility.include : [];
  visibility.exclude = Array.isArray(visibility.exclude) ? visibility.exclude : [];
  visibility.providers = visibility.providers && typeof visibility.providers === 'object'
    ? visibility.providers
    : {};
  catalog.maxLiveFree = Number.isFinite(catalog.maxLiveFree) ? catalog.maxLiveFree : DEFAULT_MODELS_CONFIG.catalog.maxLiveFree;
  catalog.liveOpenRouter = catalog.liveOpenRouter !== false;
  return { visibility, catalog };
}

export function readLiveCatalogCache({ homeDir = os.homedir(), maxAgeMs = CACHE_TTL_MS } = {}) {
  const file = cachePath(homeDir);
  try {
    if (!fs.existsSync(file)) return null;
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!parsed?.fetchedAt || !Array.isArray(parsed.models)) return null;
    if (Date.now() - parsed.fetchedAt > maxAgeMs) return null;
    return parsed.models;
  } catch {
    return null;
  }
}

export function writeLiveCatalogCache(models, { homeDir = os.homedir() } = {}) {
  const file = cachePath(homeDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({
    fetchedAt: Date.now(),
    models: models.map((m) => ({
      id: m.id,
      name: m.name ?? m.id,
      isFree: m.isFree === true,
    })),
  }, null, 2));
}

export async function refreshLiveOpenRouterCatalog({ env = process.env, homeDir = os.homedir() } = {}) {
  const apiKey = resolveFirstSecret(['OPENROUTER_API_KEY', 'OPEN_ROUTER_API_KEY'], { env });
  if (!apiKey) return [];
  const models = await pollFreeModels(apiKey);
  writeLiveCatalogCache(models, { homeDir });
  return models;
}

function providerFamilyEnabled(providerId, visibility) {
  const map = visibility.providers || {};
  if (Object.keys(map).length === 0) return true;
  if (map[providerId] === false) return false;
  if (providerId.startsWith('openrouter') && map.openrouter === false) return false;
  return map[providerId] !== false;
}

function collectTierDefaultIds(registryModels = {}) {
  const ids = [];
  for (const tier of ['reasoning', 'standard', 'fast']) {
    const def = registryModels[tier];
    if (typeof def === 'string') ids.push(def);
    else if (def && typeof def === 'object') {
      if (def.primary) ids.push(def.primary);
      if (Array.isArray(def.fallback)) ids.push(...def.fallback);
    }
  }
  return uniqueStrings(ids);
}

export function mergeLiveModelsIntoProviders(providers, liveModels = [], { maxLiveFree = 24 } = {}) {
  if (!liveModels.length) return providers;
  const liveIds = liveModels.slice(0, maxLiveFree).map((m) => (
    m.id?.startsWith('openrouter/') ? m.id : `openrouter/${m.id}`
  ));
  return providers.map((provider) => {
    if (provider.id !== 'openrouter' && !provider.id.startsWith('openrouter')) return provider;
    const options = {
      reasoning: uniqueStrings([...(provider.options?.reasoning ?? []), ...liveIds]),
      standard: uniqueStrings([...(provider.options?.standard ?? []), ...liveIds]),
      fast: uniqueStrings([...(provider.options?.fast ?? []), ...liveIds]),
    };
    return { ...provider, options, liveModelCount: liveIds.length };
  });
}

export function applyModelVisibilityFilter(catalog, {
  visibility = DEFAULT_MODELS_CONFIG.visibility,
  registryModels = {},
  activeModelId = null,
} = {}) {
  const includeSet = new Set(visibility.include || []);
  const excludeSet = new Set(visibility.exclude || []);
  const tierDefaults = collectTierDefaultIds(registryModels);

  const modelAllowed = (modelId, providerId) => {
    if (!modelId) return false;
    if (modelId === activeModelId) return true;
    if (excludeSet.has(modelId)) return false;
    if (!providerFamilyEnabled(providerId, visibility)) return false;
    if (visibility.mode === 'explicit') {
      return includeSet.has(modelId);
    }
    if (visibility.mode === 'tier_defaults') {
      return tierDefaults.includes(modelId);
    }
    return true;
  };

  const providers = catalog.providers
    .filter((provider) => providerFamilyEnabled(provider.id, visibility))
    .map((provider) => {
      const options = {};
      for (const tier of ['reasoning', 'standard', 'fast']) {
        options[tier] = (provider.options?.[tier] ?? []).filter((id) => modelAllowed(id, provider.id));
      }
      const tiers = { ...provider.tiers };
      for (const tier of ['reasoning', 'standard', 'fast']) {
        if (tiers[tier] && !modelAllowed(tiers[tier], provider.id)) {
          tiers[tier] = options[tier]?.[0] ?? null;
        }
      }
      return { ...provider, options, tiers };
    });

  const tierOptions = {
    reasoning: uniqueStrings(providers.flatMap((p) => p.options.reasoning)),
    standard: uniqueStrings(providers.flatMap((p) => p.options.standard)),
    fast: uniqueStrings(providers.flatMap((p) => p.options.fast)),
  };

  return { providers, tierOptions, visibility, activeModelId };
}

export function loadModelsCatalogContext({ cwd = process.cwd(), env = process.env, homeDir = os.homedir() } = {}) {
  const { config } = loadProjectConfig(cwd, env);
  const modelsConfig = resolveModelsConfig(config);
  let registryModels = {};
  try {
    const registryPath = path.join(cwd, 'specialists', 'unified-registry.json');
    if (fs.existsSync(registryPath)) {
      registryModels = JSON.parse(fs.readFileSync(registryPath, 'utf8')).models ?? {};
    }
  } catch { /* registry read is best-effort outside repo root */ }
  const liveModels = modelsConfig.catalog.liveOpenRouter
    ? (readLiveCatalogCache({ homeDir }) ?? [])
    : [];
  return { modelsConfig, registryModels, liveModels };
}

export function isModelVisible(modelId, {
  visibility = DEFAULT_MODELS_CONFIG.visibility,
  registryModels = {},
  activeModelId = null,
  providerId = null,
} = {}) {
  const filtered = applyModelVisibilityFilter(
    { providers: [{ id: providerId || 'openrouter', options: { reasoning: [modelId], standard: [modelId], fast: [modelId] }, tiers: {} }] },
    { visibility, registryModels, activeModelId },
  );
  return filtered.providers.some((p) =>
    ['reasoning', 'standard', 'fast'].some((tier) => (p.options[tier] ?? []).includes(modelId)),
  );
}
