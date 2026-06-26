/**
 * lib/chat/model-picker-filter.mjs — Curate live provider polls for the chat model picker.
 *
 * The OpenRouter /models endpoint returns hundreds of entries; the picker should
 * show tier defaults, a capped free slice, and the active session model — not the
 * raw catalog. Non-chat artifacts and tool-incapable models are dropped.
 */

import { isChatModelAvailable, getPickerModelAllowlist } from '../model-router.mjs';
import { loadModelsCatalogContext } from '../models/catalog.mjs';

const OPENROUTER_JUNK_RE = /(embed|rerank|whisper|tts|dall-e|moderation|transcribe|sora|babbage|davinci)/i;
const MIN_OPENROUTER_CONTEXT = 8000;

export function isChatSuitablePollModel(model) {
  if (!model || model.disabled || model.source === 'hint') return false;
  if (model.toolsKnown === true && !model.tools) return false;

  if (model.provider === 'openrouter') {
    const native = String(model.id || '').replace(/^openrouter\//, '');
    if (OPENROUTER_JUNK_RE.test(native)) return false;
    const outputs = model.architecture?.output_modalities;
    if (Array.isArray(outputs) && outputs.length && !outputs.includes('text')) return false;
    if (Number.isFinite(model.context) && model.context < MIN_OPENROUTER_CONTEXT && !model.free) {
      return false;
    }
  }

  return true;
}

function dedupeModels(models) {
  const seen = new Set();
  const out = [];
  for (const model of models) {
    if (!model?.id || seen.has(model.id)) continue;
    seen.add(model.id);
    out.push(model);
  }
  return out;
}

export function curatePollModelsForPicker(models, {
  groupId,
  env = process.env,
  cwd = process.cwd(),
  currentModel = null,
  modelsConfig = null,
} = {}) {
  const suitable = (models || []).filter(isChatSuitablePollModel);
  if (!suitable.length) return suitable;

  const { modelsConfig: resolvedConfig } = modelsConfig
    ? { modelsConfig }
    : loadModelsCatalogContext({ cwd, env });
  const config = modelsConfig || resolvedConfig;
  const allowed = getPickerModelAllowlist({
    env,
    cwd,
    currentModel,
    modelsConfig: config,
  });
  const visibilityMode = config?.visibility?.mode || 'tier_defaults';
  const maxFree = config?.catalog?.maxLiveFree ?? 24;

  if (groupId === 'openrouter') {
    const curated = suitable.filter((m) => allowed.has(m.id));
    if (visibilityMode === 'all_configured') {
      const freeExtras = suitable
        .filter((m) => m.free && !allowed.has(m.id))
        .sort((a, b) => (b.context || 0) - (a.context || 0))
        .slice(0, maxFree);
      return dedupeModels([...curated, ...freeExtras]);
    }
    return dedupeModels(curated);
  }

  if (groupId === 'ollama' || groupId === 'local') {
    return suitable;
  }

  return suitable.filter((m) => {
    if (m.id === currentModel) return true;
    if (allowed.has(m.id)) return true;
    if (['anthropic', 'openai', 'github-copilot'].includes(groupId)) {
      return isChatModelAvailable(m.id, { env }).ok;
    }
    return isChatModelAvailable(m.id, { env }).ok;
  });
}
