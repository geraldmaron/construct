/**
 * lib/models/provider-poll.mjs — live, per-provider model enumeration for the picker.
 *
 * Each configured provider is queried at its own list endpoint so the picker
 * shows the provider's actual catalog rather than a shipped guess: OpenRouter
 * /api/v1/models, OpenAI /v1/models, Anthropic /v1/models, GitHub Copilot
 * /models, and Ollama /api/tags. Providers without a list API (or whose poll
 * fails) fall back to the curated tier options, flagged source:'curated' so the
 * UI never implies a live result it could not verify. Every poller is
 * best-effort: it resolves to [] on any error and never throws, and results are
 * cached to ~/.cx/provider-catalog-cache.json so repeat opens are instant. When a
 * fresh catalog (within CACHE_TTL_MS) already covers every configured provider it
 * is served directly without polling, so opening the picker on a warm cache
 * resolves no secret and triggers no 1Password prompt.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveFirstSecret } from '../providers/secret-resolver.mjs';
import { getProviderModelCatalog } from '../model-router.mjs';
import { listInstalledOllamaModels, toOllamaNativeModelId } from '../ollama/installed-models.mjs';
import { getPricingForModels } from '../model-pricing.mjs';
import { doctorRoot } from '../config/xdg.mjs';

const FETCH_TIMEOUT_MS = 10_000;
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_FILENAME = 'provider-catalog-cache.json';

const PROVIDER_LABELS = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  'github-copilot': 'GitHub Copilot',
  openrouter: 'OpenRouter',
  ollama: 'Ollama (local)',
  local: 'Local',
};

// Render order for groups: first-party hosted, then the OpenRouter aggregator,
// then local runtimes. Unknown providers sort after these by label.
const PROVIDER_ORDER = ['anthropic', 'openai', 'github-copilot', 'openrouter', 'ollama', 'local'];

function cachePath(homeDir = os.homedir()) {
  return path.join(doctorRoot(homeDir), CACHE_FILENAME);
}

async function fetchJson(url, { headers = {}, signal } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers, signal: signal || controller.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function isFreePricing(pricing) {
  return pricing?.prompt === '0' && pricing?.completion === '0';
}

// OpenRouter advertises capabilities through supported_parameters and the
// architecture modality lists, so reasoning/tools/vision are read, not inferred.
function openRouterCapabilities(model) {
  const params = Array.isArray(model.supported_parameters) ? model.supported_parameters : [];
  const inputs = model.architecture?.input_modalities || [];
  return {
    reasoning: params.includes('reasoning') || params.includes('include_reasoning'),
    tools: params.includes('tools') || params.includes('tool_choice'),
    vision: Array.isArray(inputs) && inputs.includes('image'),
  };
}

function resolveSecretOrNull(varNames, opts) {
  try {
    return resolveFirstSecret(varNames, opts);
  } catch {
    return null;
  }
}

export async function pollOpenRouter({ env = process.env } = {}) {
  const apiKey = resolveSecretOrNull(['OPENROUTER_API_KEY', 'OPEN_ROUTER_API_KEY'], { env, allowAmbient: env === process.env });
  const headers = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
  const data = await fetchJson('https://openrouter.ai/api/v1/models', { headers });
  if (!data) return null;
  const list = Array.isArray(data?.data) ? data.data : [];
  const models = [];
  for (const m of list) {
    if (!m?.id) continue;
    const outputs = m.architecture?.output_modalities;
    if (Array.isArray(outputs) && outputs.length && !outputs.includes('text')) continue;
    if (/(embed|rerank|whisper|tts|dall-e|moderation|transcribe|sora)/i.test(m.id)) continue;
    const free = isFreePricing(m.pricing);
    const input = Number(m.pricing?.prompt);
    const output = Number(m.pricing?.completion);
    const caps = openRouterCapabilities(m);
    const context = Number(m.context_length) || null;
    if (!free && context && context < 8000) continue;
    models.push({
      id: `openrouter/${m.id}`,
      label: m.name || m.id,
      provider: 'openrouter',
      free,
      pricing: Number.isFinite(input) && Number.isFinite(output)
        ? { input: input * 1_000_000, output: output * 1_000_000 }
        : null,
      context,
      reasoning: caps.reasoning,
      tools: caps.tools,
      toolsKnown: true,
      vision: caps.vision,
      architecture: m.architecture || null,
      source: 'live',
    });
  }
  return models;
}

// The OpenAI list endpoint returns every artifact id (embeddings, audio, image,
// moderation) with no capability or pricing metadata. Keep only chat-capable
// families and mark the o-series as reasoning, which is definitional rather than
// guessed.
const OPENAI_NON_CHAT = /(embedding|whisper|tts|audio|realtime|image|dall-e|moderation|search|babbage|davinci|transcribe|sora)/i;

export async function pollOpenAI({ env = process.env } = {}) {
  const apiKey = resolveSecretOrNull(['OPENAI_API_KEY'], { env, allowAmbient: env === process.env });
  if (!apiKey) return null;
  const data = await fetchJson('https://api.openai.com/v1/models', {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!data) return null;
  const list = Array.isArray(data?.data) ? data.data : [];
  const models = [];
  for (const m of list) {
    const nativeId = m?.id;
    if (!nativeId) continue;
    if (OPENAI_NON_CHAT.test(nativeId)) continue;
    if (!/^(gpt-|o\d|chatgpt)/i.test(nativeId)) continue;
    models.push({
      id: `openai/${nativeId}`,
      label: nativeId,
      provider: 'openai',
      free: false,
      pricing: null,
      context: null,
      reasoning: /^o\d/i.test(nativeId),
      tools: !/instruct/i.test(nativeId),
      toolsKnown: true,
      vision: false,
      source: 'live',
    });
  }
  return models;
}

export async function pollAnthropic({ env = process.env } = {}) {
  const apiKey = resolveSecretOrNull(['ANTHROPIC_API_KEY'], { env, allowAmbient: env === process.env });
  if (!apiKey) return null;
  const data = await fetchJson('https://api.anthropic.com/v1/models?limit=100', {
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
  });
  if (!data) return null;
  const list = Array.isArray(data?.data) ? data.data : [];
  const models = [];
  for (const m of list) {
    const nativeId = m?.id;
    if (!nativeId) continue;
    models.push({
      id: `anthropic/${nativeId}`,
      label: m.display_name || nativeId,
      provider: 'anthropic',
      free: false,
      pricing: null,
      context: null,
      reasoning: false,
      tools: true,
      toolsKnown: true,
      vision: false,
      source: 'live',
    });
  }
  return models;
}

// Copilot tags reasoning support with a reasoning_effort list; a list that is
// only ['none'] is not a reasoning model. adaptive_thinking is the Claude-family
// equivalent.
function copilotReasoning(supports) {
  const effort = supports.reasoning_effort;
  if (Array.isArray(effort) && effort.some((e) => e && e !== 'none')) return true;
  return Boolean(supports.adaptive_thinking);
}

export async function pollCopilot() {
  try {
    const { getCopilotToken, copilotApiHeaders, COPILOT_API_BASE } = await import('../providers/copilot-auth.mjs');
    const token = await getCopilotToken();
    const data = await fetchJson(`${COPILOT_API_BASE}/models`, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, ...copilotApiHeaders() },
    });
    if (!data) return null;
    const list = Array.isArray(data?.data) ? data.data : (Array.isArray(data) ? data : []);
    const seen = new Set();
    const models = [];
    for (const m of list) {
      const nativeId = m?.id || m?.model;
      if (!nativeId || seen.has(nativeId)) continue;
      if (m?.model_picker_enabled === false) continue;
      if (m?.capabilities?.type && m.capabilities.type !== 'chat') continue;
      seen.add(nativeId);
      const caps = m?.capabilities || {};
      const supports = caps.supports || {};
      models.push({
        id: `github-copilot/${nativeId}`,
        label: m?.name || nativeId,
        provider: 'github-copilot',
        free: false,
        pricing: null,
        context: Number(caps.limits?.max_prompt_tokens || caps.limits?.max_context_window_tokens) || null,
        reasoning: copilotReasoning(supports),
        tools: Boolean(supports.tool_calls),
        toolsKnown: true,
        vision: Boolean(supports.vision) || Boolean(caps.limits?.vision),
        source: 'live',
      });
    }
    return models;
  } catch {
    return null;
  }
}

export function pollOllama({ env = process.env } = {}) {
  const { models: installed, listable } = listInstalledOllamaModels({ env });
  if (!listable || !installed) return null;
  const models = [];
  for (const native of installed) {
    models.push({
      id: `ollama/${native}`,
      label: native,
      provider: 'ollama',
      free: true,
      pricing: { input: 0, output: 0 },
      context: null,
      reasoning: false,
      tools: false,
      toolsKnown: false,
      vision: false,
      source: 'live',
    });
  }
  return models;
}

// When a configured provider can't be reached (or exposes no list endpoint), say
// so plainly instead of inventing a model list. The hint renders as a disabled,
// unselectable row so the group is never silently empty and never fabricated.
const UNREACHABLE_HINTS = {
  ollama: 'Ollama server not reachable — start it with `ollama serve`',
};

function unreachableHint(groupId, label) {
  return {
    id: `__unreachable__/${groupId}`,
    label: UNREACHABLE_HINTS[groupId] || `${label} unreachable — check credentials or connection`,
    provider: groupId,
    free: false,
    pricing: null,
    context: null,
    reasoning: false,
    tools: false,
    vision: false,
    disabled: true,
    source: 'hint',
  };
}

function providerGroupId(familyId) {
  return familyId.startsWith('openrouter') ? 'openrouter' : familyId;
}

// Returns the provider's live model list, or null when the provider could not be
// reached or has no list endpoint (the 'local' runtime). null is distinct from an
// empty array, which means "reached, but the account exposes no models".
async function pollLiveFor(groupId, env) {
  if (groupId === 'openrouter') return pollOpenRouter({ env });
  if (groupId === 'openai') return pollOpenAI({ env });
  if (groupId === 'anthropic') return pollAnthropic({ env });
  if (groupId === 'github-copilot') return pollCopilot();
  if (groupId === 'ollama') return pollOllama({ env });
  return null;
}

async function enrichPricing(models, { env }) {
  const needPricing = models.filter((m) => !m.pricing && m.provider !== 'ollama' && m.provider !== 'local').map((m) => m.id);
  if (!needPricing.length) return models;
  let priceMap = {};
  try {
    priceMap = await getPricingForModels(needPricing);
  } catch { /* pricing is best-effort */ }
  return models.map((m) => {
    if (m.pricing || !priceMap[m.id]) return m;
    const hit = priceMap[m.id];
    return { ...m, pricing: { input: hit.input, output: hit.output } };
  });
}

function sortProviderGroups(groups) {
  return groups.sort((a, b) => {
    const ai = PROVIDER_ORDER.indexOf(a.id);
    const bi = PROVIDER_ORDER.indexOf(b.id);
    return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi) || a.label.localeCompare(b.label);
  });
}

/**
 * Poll every configured provider in parallel and return one group per provider,
 * in render order, each with its live model list. A provider that can't be
 * reached falls back to its last-good cached list (flagged source:'cached'), or
 * to a disabled unreachable hint when there is no cache — never to an invented
 * list. Successful live polls refresh the on-disk cache.
 */
export async function pollConfiguredProviders({ env = process.env, cwd = process.cwd(), homeDir = os.homedir() } = {}) {
  const { providers } = getProviderModelCatalog({ env, cwd });
  const configured = providers.filter((p) => p.configured);

  const groupIds = [];
  const groupForId = new Map();
  for (const provider of configured) {
    const gid = providerGroupId(provider.id);
    if (!groupForId.has(gid)) {
      groupForId.set(gid, { id: gid, label: PROVIDER_LABELS[gid] || provider.label });
      groupIds.push(gid);
    }
  }

  // Cache-first: when a fresh catalog (within TTL) already covers every configured
  // provider, serve it without resolving any secret. Opening the picker on a warm
  // cache must not spawn `op read` or trigger a 1Password prompt.
  const freshCached = readProviderCatalogCache({ homeDir, maxAgeMs: CACHE_TTL_MS }) || [];
  const freshById = new Map(freshCached.map((g) => [g.id, g]));
  if (groupIds.length && groupIds.every((gid) => freshById.get(gid)?.models?.length)) {
    const fresh = groupIds.map((gid) => {
      const group = groupForId.get(gid);
      const cachedGroup = freshById.get(gid);
      return {
        id: gid,
        label: group.label,
        models: cachedGroup.models.map((m) => ({ ...m, source: 'cached' })),
        live: false,
      };
    });
    return sortProviderGroups(fresh);
  }

  const cached = readProviderCatalogCache({ homeDir, maxAgeMs: Infinity }) || [];
  const cachedById = new Map(cached.map((g) => [g.id, g]));

  // A single provider's credential resolution can throw (e.g. an op:// ref on a
  // machine without the 1Password CLI). Isolate each poll so that failure
  // degrades only its own group to cached/unreachable, never the whole picker.
  const polled = await Promise.all(groupIds.map(async (gid) => {
    let live = null;
    try {
      live = await pollLiveFor(gid, env);
    } catch {
      live = null;
    }
    return { gid, live };
  }));

  const groups = [];
  const liveGroupsToCache = [];
  for (const { gid, live } of polled) {
    const group = groupForId.get(gid);
    if (Array.isArray(live)) {
      const enriched = await enrichPricing(live, { env });
      groups.push({ id: gid, label: group.label, models: enriched, live: true });
      liveGroupsToCache.push({ id: gid, label: group.label, models: enriched });
      continue;
    }
    const cachedGroup = cachedById.get(gid);
    if (cachedGroup?.models?.length) {
      groups.push({
        id: gid,
        label: group.label,
        models: cachedGroup.models.map((m) => ({ ...m, source: 'cached' })),
        live: false,
      });
      liveGroupsToCache.push(cachedGroup);
      continue;
    }
    groups.push({ id: gid, label: group.label, models: [unreachableHint(gid, group.label)], live: false });
  }

  sortProviderGroups(groups);

  if (liveGroupsToCache.length) writeProviderCatalogCache(liveGroupsToCache, { homeDir });

  return groups;
}

export function readProviderCatalogCache({ homeDir = os.homedir(), maxAgeMs = CACHE_TTL_MS, now = Date.now() } = {}) {
  try {
    const parsed = JSON.parse(fs.readFileSync(cachePath(homeDir), 'utf8'));
    if (!parsed?.fetchedAt || !Array.isArray(parsed.groups)) return null;
    if (now - parsed.fetchedAt > maxAgeMs) return null;
    return parsed.groups;
  } catch {
    return null;
  }
}

export function writeProviderCatalogCache(groups, { homeDir = os.homedir(), now = Date.now() } = {}) {
  try {
    const file = cachePath(homeDir);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ fetchedAt: now, groups }, null, 2));
  } catch { /* cache write is best-effort */ }
}
