/**
 * lib/model-policy.mjs — user-facing model policy: presets, the effective-policy
 * view, and per-specialist resolution traces, layered on the existing resolution
 * chain (lib/model-router.mjs + lib/embedded-contract/model-resolve.mjs).
 *
 * Design constraint: the single edit surface for model
 * assignment is registry/models.json. config.schema is deliberately not a
 * second surface. Presets are COMPUTED here from the cost/free selectors
 * (model-cheapest-provider / model-free-selector / model-pricing) and then
 * PERSISTED to models.json, which already sits below env pins in the chain — so
 * CONSTRUCT_MODEL_<TIER> pins keep overriding and nothing new enters the chain.
 *
 * Budget invariant: computeBudgetTiers never treats a missing price as $0. An
 * unknown or unreachable price ranks a candidate LAST, and flagship ids are
 * hard-excluded — so with only an OpenRouter credential no frontier model can be
 * selected for any tier, even when live pricing is unreachable.
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  defaultModelRegistryPath,
  getProviderModelCatalog,
  resolveModelTiers,
  MODEL_TIER_BY_WORK_CATEGORY,
} from './model-router.mjs';
import { getPricingForModels } from './model-pricing.mjs';
import { pollFreeModels, selectForTier, isFreeModel } from './model-free-selector.mjs';
import { getWorkerProfile } from './registry/loader.mjs';
import { MODEL_TIERS } from './model-tiers.mjs';

export const POLICY_PRESETS = ['budget', 'free', 'frontier', 'local'];
export const POLICY_TIERS = MODEL_TIERS;

// Flagship, high-cost models a budget/free policy must never resolve to. The set
// mirrors the reasoning/standard flagships declared in PROVIDER_FAMILY_TIERS so a
// preset can hard-exclude them regardless of whether live pricing was reachable;
// the regex catches the same families' newer point releases.

const FRONTIER_MODEL_IDS = new Set([
  'anthropic/claude-opus-4-6',
  'anthropic/claude-sonnet-4-6',
  'openrouter/anthropic/claude-opus-4-6',
  'openrouter/anthropic/claude-sonnet-4-6',
  'openai/gpt-5.4',
  'openai/gpt-5.1',
  'openrouter/openai/gpt-5.4',
  'openrouter/openai/gpt-5.1',
  'openrouter/google/gemini-2.5-pro',
  'openrouter/meta-llama/llama-3.1-405b-instruct',
  'github-copilot/gpt-5.5',
  'github-copilot/gpt-5.4',
]);

const FRONTIER_PATTERN = /(claude-opus|claude-sonnet|gpt-5\.(4|5)|gemini-2\.5-pro|llama-3\.1-405b|405b-instruct)/i;

export function isFrontierModel(modelId) {
  if (!modelId || typeof modelId !== 'string') return false;
  if (isFreeModel(modelId)) return false;
  return FRONTIER_MODEL_IDS.has(modelId) || FRONTIER_PATTERN.test(modelId);
}

function uniq(values) {
  return [...new Set(values.filter((v) => typeof v === 'string' && v.trim()))];
}

function configuredProviders(env) {
  const catalog = getProviderModelCatalog({ env });
  return catalog.providers.filter((p) => p.configured);
}

function tierDefinition(primary, fallback = []) {
  return { primary, fallback: uniq(fallback.filter((id) => id !== primary)) };
}

// Candidate models for a tier from every configured provider: the tier pin plus
// the shipped option list. Frontier ids are dropped so a budget/free preset can
// never rank one, whatever the pricing outcome.

function budgetCandidates(providers, tier) {
  const ids = [];
  const local = new Set();
  for (const p of providers) {
    const list = uniq([p.tiers?.[tier], ...(p.options?.[tier] ?? [])]);
    for (const id of list) {
      ids.push(id);
      if (p.local === true) local.add(id);
    }
  }
  return { ids: uniq(ids).filter((id) => !isFrontierModel(id)), local };
}

/**
 * Compute the budget tier assignments: the cheapest eligible model per tier from
 * configured providers. Unknown/unreachable prices rank LAST (never $0), so the
 * budget invariant holds even when the pricing fetch fails.
 */
export async function computeBudgetTiers({ env = process.env, getPricing = getPricingForModels } = {}) {
  const providers = configuredProviders(env);
  const warnings = [];
  const models = {};
  let pricingDegraded = false;

  for (const tier of POLICY_TIERS) {
    const { ids, local } = budgetCandidates(providers, tier);
    if (ids.length === 0) {
      models[tier] = tierDefinition(null, []);
      continue;
    }

    let pricing = {};
    try {
      pricing = await getPricing(ids);
    } catch {
      pricing = {};
    }

    const scored = ids.map((id) => {
      if (local.has(id)) return { id, cost: 0, priced: true };
      const entry = pricing[id];
      if (entry && Number.isFinite(Number(entry.input)) && Number.isFinite(Number(entry.output))) {
        return { id, cost: Number(entry.input) + Number(entry.output), priced: true };
      }
      return { id, cost: Number.POSITIVE_INFINITY, priced: false };
    });

    const priced = scored.filter((s) => s.priced);
    if (priced.length === 0) {
      // No candidate had a reachable price. Fall back to a deterministic static
      // ordering — a :free slug first, else the first non-frontier candidate —
      // and say so rather than silently ranking on missing data.
      pricingDegraded = true;
      const free = ids.find((id) => isFreeModel(id));
      const primary = free ?? ids[0];
      models[tier] = tierDefinition(primary, ids.filter((id) => id !== primary).slice(0, 2));
      continue;
    }

    scored.sort((a, b) => a.cost - b.cost);
    const primary = scored[0].id;
    const fallback = scored.slice(1).filter((s) => Number.isFinite(s.cost)).map((s) => s.id).slice(0, 2);
    models[tier] = tierDefinition(primary, fallback);
  }

  if (pricingDegraded) {
    warnings.push('Live pricing was unreachable for at least one tier; used static ordering (a :free slug, else the first eligible candidate).');
  }
  return { models, warnings };
}

/**
 * Compute the free tier assignments: :free OpenRouter slugs only. A tier with no
 * available free model is left null and reported, never silently substituted.
 */
export async function computeFreeTiers({ env = process.env, apiKey = null, poll = pollFreeModels } = {}) {
  const warnings = [];
  const models = {};
  const key = apiKey || env.OPENROUTER_API_KEY || env.OPEN_ROUTER_API_KEY || null;
  const freeModels = key ? await poll(key) : [];

  for (const tier of POLICY_TIERS) {
    const id = selectForTier(freeModels, tier, []);
    if (id && isFreeModel(id)) {
      models[tier] = tierDefinition(id, []);
    } else {
      models[tier] = tierDefinition(null, []);
      warnings.push(`No free model available for the ${tier} tier; left unset (run \`construct models free\` to inspect the live catalog).`);
    }
  }
  return { models, warnings };
}

// Best-available (flagship) per tier from configured providers, ranked by a fixed
// capability order. This is the deliberately-expensive preset, so frontier ids are
// not excluded here.

const FRONTIER_PROVIDER_ORDER = [
  'anthropic',
  'openai',
  'openrouter-anthropic',
  'openrouter-openai',
  'github-copilot',
  'openrouter-google',
  'openrouter-deepseek',
  'openrouter-llama',
  'openrouter-qwen',
  'openrouter',
];

export function computeFrontierTiers({ env = process.env } = {}) {
  const providers = configuredProviders(env);
  const ranked = [...providers].sort((a, b) => {
    const ia = FRONTIER_PROVIDER_ORDER.indexOf(a.id);
    const ib = FRONTIER_PROVIDER_ORDER.indexOf(b.id);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });
  const models = {};
  for (const tier of POLICY_TIERS) {
    const provider = ranked.find((p) => p.tiers?.[tier]);
    const primary = provider?.tiers?.[tier] ?? null;
    const fallback = ranked.filter((p) => p !== provider).map((p) => p.tiers?.[tier]).filter(Boolean);
    models[tier] = tierDefinition(primary, fallback.slice(0, 2));
  }
  return { models, warnings: [] };
}

export function computeLocalTiers({ env = process.env } = {}) {
  const providers = configuredProviders(env).filter((p) => p.local === true);
  const models = {};
  for (const tier of POLICY_TIERS) {
    const provider = providers.find((p) => p.tiers?.[tier]);
    const primary = provider?.tiers?.[tier] ?? null;
    const fallback = providers.filter((p) => p !== provider).map((p) => p.tiers?.[tier]).filter(Boolean);
    models[tier] = tierDefinition(primary, fallback.slice(0, 2));
  }
  return { models, warnings: [] };
}

/**
 * Compute a preset's per-tier assignments. Refuses (ok:false) with a clear
 * message when no provider credential can back the preset, so a preset never
 * silently writes an unbacked frontier default.
 */
export async function computePolicyPreset(preset, { env = process.env, apiKey = null, getPricing, poll } = {}) {
  if (!POLICY_PRESETS.includes(preset)) {
    return { ok: false, refusal: `Unknown preset '${preset}'. Choose one of: ${POLICY_PRESETS.join(', ')}.` };
  }

  const providers = configuredProviders(env);
  const localProviders = providers.filter((p) => p.local === true);
  const hasOpenRouter = Boolean(env.OPENROUTER_API_KEY || env.OPEN_ROUTER_API_KEY);

  if (preset === 'free' && !hasOpenRouter) {
    return { ok: false, refusal: 'The `free` preset needs an OpenRouter credential (OPENROUTER_API_KEY). Set one, then rerun.' };
  }
  if (preset === 'local' && localProviders.length === 0) {
    return { ok: false, refusal: 'The `local` preset needs a local provider (Ollama or a local OpenAI-compatible server). Start one, then rerun.' };
  }
  if ((preset === 'budget' || preset === 'frontier') && providers.length === 0) {
    return { ok: false, refusal: `The \`${preset}\` preset needs at least one configured provider credential. Set an API key (e.g. OPENROUTER_API_KEY / ANTHROPIC_API_KEY), then rerun.` };
  }

  let result;
  if (preset === 'budget') result = await computeBudgetTiers({ env, ...(getPricing ? { getPricing } : {}) });
  else if (preset === 'free') result = await computeFreeTiers({ env, apiKey, ...(poll ? { poll } : {}) });
  else if (preset === 'frontier') result = computeFrontierTiers({ env });
  else result = computeLocalTiers({ env });

  const anyResolved = POLICY_TIERS.some((tier) => result.models[tier]?.primary);
  if (!anyResolved) {
    return { ok: false, refusal: `No model could be computed for the \`${preset}\` preset with the current credentials.`, warnings: result.warnings };
  }

  return { ok: true, preset, models: result.models, warnings: result.warnings ?? [] };
}

/**
 * Persist computed tier assignments to the models.json registry — the single
 * edit surface. Writes only `models`; env pins keep overriding at resolution.
 */
export function writeModelRegistry(registryPath, models, { preset = null } = {}) {
  const payload = {
    _comment: `Written by \`construct models policy set${preset ? ` ${preset}` : ''}\` (construct-760c.7). Tier defaults below fill only tiers no CONSTRUCT_MODEL_<TIER> env pin sets; env pins always win. Edit via \`construct models policy set <preset>\` or \`construct models set\`.`,
    models: {},
  };
  for (const tier of POLICY_TIERS) {
    const def = models[tier];
    if (def?.primary) payload.models[tier] = { primary: def.primary, fallback: def.fallback ?? [] };
  }
  fs.mkdirSync(path.dirname(registryPath), { recursive: true });
  fs.writeFileSync(registryPath, `${JSON.stringify(payload, null, 2)}\n`);
  return payload;
}

/**
 * Effective-policy view: per-tier resolved model and the winning source, plus the
 * work-category → tier map. Reads through resolveModelTiers so an env pin is
 * attributed as the winning source over a registry default.
 */
export function readPolicyView({ env = process.env, registryPath = null } = {}) {
  const resolvedRegistryPath = registryPath ?? defaultModelRegistryPath(env);
  const resolution = resolveModelTiers({ env, registryPath: resolvedRegistryPath });
  const tiers = POLICY_TIERS.map((tier) => ({
    tier,
    model: resolution.models[tier],
    source: resolution.sources[tier],
    envPin: env[`CONSTRUCT_MODEL_${tier.toUpperCase()}`] || null,
  }));
  return {
    registryPath: resolvedRegistryPath,
    tiers,
    workCategoryMap: { ...MODEL_TIER_BY_WORK_CATEGORY },
    configured: resolution.configured,
    complete: resolution.complete,
  };
}

/**
 * Per-specialist resolution trace: the specialist's declared modelTier/model, the
 * tier it maps to, and the winning rule for that tier. Mirrors what
 * `construct models resolve --json --tier <tier>` reports for the same tier.
 */
export function explainRole(roleId, { env = process.env, registryPath = null, rootDir = null } = {}) {
  const profileId = String(roleId).replace(/^cx-/, '');
  const workerProfile = getWorkerProfile(profileId, rootDir ? { rootDir } : {});
  if (!workerProfile) {
    return { ok: false, error: `Unknown worker profile '${profileId}'.` };
  }

  const declaredModel = workerProfile.model || null;
  const declaredTier = workerProfile.modelTier || null;
  const tier = declaredTier || 'standard';

  const resolvedRegistryPath = registryPath ?? defaultModelRegistryPath(env);
  const resolution = resolveModelTiers({ env, registryPath: resolvedRegistryPath });

  const resolvedModel = declaredModel || resolution.models[tier];
  const source = declaredModel ? 'worker profile model pin' : resolution.sources[tier];

  return {
    ok: true,
    workerProfile: workerProfile.id,
    declaredModel,
    declaredTier,
    tier,
    resolvedModel,
    source,
    registryPath: resolvedRegistryPath,
  };
}
