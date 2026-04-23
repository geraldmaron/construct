/**
 * lib/model-free-selector.mjs — Free model polling, scoring, and selection.
 *
 * Extracted from model-router.mjs to keep each module under 800 lines.
 * Polls OpenRouter for free models, scores them by tier, and provides
 * helpers for free-preference modes (global, same-family).
 *
 * Consumed by:
 *   • bin/construct          – model configuration commands (--auto, --apply).
 *   • lib/model-router.mjs  – re-exports for backward compatibility.
 */

const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";
const FETCH_TIMEOUT_MS = 10_000;

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

  return models.sort((a, b) => score(b, "standard") - score(a, "standard"));
}

/**
 * Score a model for a given tier (higher is better).
 * @param {object} model – Model object as returned by `pollFreeModels`.
 * @param {"reasoning"|"standard"|"fast"} tier – The tier to score for.
 * @returns {number} – Numerical score used for ranking.
 */
export function score(model, tier) {
  const { id, contextLength } = model;
  let s = 0;

  // Context-length weighting
  if (contextLength >= 128_000) s += 40;
  else if (contextLength >= 32_000) s += 20;
  else if (contextLength >= 16_000) s += 10;

  // Provider-agnostic capability weighting
  if (id.includes("gemma-4")) s += 30;
  if (id.includes("gemma-3")) s += 25;
  if (id.includes("gpt-4o")) s += 25;
  if (id.includes("nemotron-3-super")) s += 20;
  if (id.includes("llama-3.3-70b")) s += 20;
  if (id.includes("qwen3") && contextLength >= 32_000) s += 20;
  if (id.includes("deepseek-r1")) s += 20;
  if (id.includes("deepseek-v3")) s += 15;
  // Extra boost for reasoning-heavy models when the tier is reasoning
  if (
    tier === "reasoning" &&
    (id.includes("deepseek-r1") ||
      id.includes("nemotron-3-super") ||
      id.includes("qwen3"))
  ) {
    s += 15;
  }

  return s;
}

/**
 * Select the best free model for a given tier from an array of free models.
 * Falls back to a registry-provided fallback chain if no suitable free model exists.
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
      .map((m) => ({ ...m, tierScore: score(m, tier) }))
      .sort((a, b) => b.tierScore - a.tierScore);

    if (candidates[0]?.id) return candidates[0].id;
  }

  return registryFallbacks[0] ?? null;
}

/**
 * Return the top N candidates for a given tier (used for UI lists).
 * @param {Array} freeModels – Array of model objects.
 * @param {"reasoning"|"standard"|"fast"} tier – Target tier.
 * @param {number} n – Number of candidates to return (default = 3).
 * @returns {Array} – Sorted candidate objects.
 */
export function topForTier(freeModels, tier, n = 3) {
  if (!freeModels || freeModels.length === 0) return [];

  const minContext = tier === "fast" ? 8_000 : tier === "standard" ? 16_000 : 32_000;
  return freeModels
    .filter((m) => m.contextLength >= minContext)
    .map((m) => ({ ...m, tierScore: score(m, tier) }))
    .sort((a, b) => b.tierScore - a.tierScore)
    .slice(0, n);
}

/**
 * Check if a model ID ends with `:free`.
 * @param {string} modelId – Model identifier.
 * @returns {boolean} – True if the model is marked as free.
 */
export function isFreeModel(modelId = "") {
  return /:free$/i.test(modelId);
}

/**
 * Choose a free model when multiple candidates exist.
 * Preference order: explicit primary > fallback > registry default > builtin default.
 * @param {string} primary – Explicitly selected model.
 * @param {string} fallback – Second-choice candidate.
 * @param {string} registryDefault – Default from registry.
 * @param {string} builtinDefault – Built-in fallback.
 * @returns {string|null} – The chosen model ID, or `null` if none selected.
 */
export function preferFreeValue(
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
