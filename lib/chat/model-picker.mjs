/**
 * lib/chat/model-picker.mjs — model list data for the construct chat picker.
 *
 * Curates a short list: free-router auto-pick, live OpenRouter free models,
 * configured provider tier defaults, and the active session model. Persistence
 * reuses saveChatConfig from lib/chat/config.mjs.
 */

import { saveChatConfig } from './config.mjs';
import { hasAnySecret } from '../providers/secret-resolver.mjs';
import { getProviderModelCatalog, isChatModelAvailable } from '../model-router.mjs';
import {
  pollConfiguredProviders,
  readProviderCatalogCache,
} from '../models/provider-poll.mjs';
import { resolveFreeOpenRouterModel } from '../../apps/chat/engine/models.mjs';
import { filterPickerItems, pickerStartIndex, windowPickerItems } from './list-picker.mjs';

export { filterPickerItems, pickerStartIndex, windowPickerItems };

export const FREE_ROUTER_ITEM_ID = '__free_router__';

export function sortModelsForPicker(models = []) {
  return [...models].sort(
    (a, b) => Number(Boolean(b.action === 'free-router')) - Number(Boolean(a.action === 'free-router'))
      || Number(Boolean(b.isFree)) - Number(Boolean(a.isFree))
      || Number(b.suitable !== false) - Number(a.suitable !== false)
      || Number(Boolean(b.isProviderDefault)) - Number(Boolean(a.isProviderDefault))
      || String(a.label || a.id).localeCompare(String(b.label || b.id)),
  );
}

function shortModelLabel(id) {
  if (!id) return id;
  const name = id.replace(/^openrouter\//, '');
  const slash = name.lastIndexOf('/');
  return slash >= 0 ? name.slice(slash + 1) : name;
}

function catalogItem(model) {
  const id = model.id;
  const isFree = id.includes(':free') || model.isFree === true;
  return {
    id,
    label: model.label || (isFree ? shortModelLabel(id) : id),
    tag: model.action === 'free-router' ? 'router' : isFree ? 'free' : model.local ? 'local' : model.tier || null,
    detail: model.detail || model.name || (model.configured === false ? 'not configured' : null),
    isFree,
    action: model.action || null,
    suitable: model.suitable,
    disabled: model.disabled === true,
  };
}

export function configuredTierPickerItems({ env = process.env } = {}) {
  const { providers } = getProviderModelCatalog({ env });
  const items = [];
  const seen = new Set();
  for (const provider of providers) {
    if (!provider.configured) continue;
    for (const tier of ['reasoning', 'standard', 'fast']) {
      const id = provider.tiers?.[tier];
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const availability = isChatModelAvailable(id, { env });
      const notPulled = availability.reason === 'model_not_pulled';
      items.push(catalogItem({
        id,
        label: id,
        name: `${provider.label} · ${tier}`,
        tier,
        configured: availability.ok,
        suitable: availability.ok,
        isProviderDefault: tier === 'standard',
        disabled: !availability.ok,
        detail: notPulled
          ? `not installed — run ollama pull ${availability.nativeModel || id.replace(/^ollama\//, '')}`
          : availability.ok ? null : availability.reason?.replace(/_/g, ' ') || 'unavailable',
      }));
    }
  }
  return { items, seen };
}

function capabilityBadges(model) {
  const badges = [];
  if (model.reasoning) badges.push('reasoning');
  if (model.vision) badges.push('vision');
  if (model.tools) badges.push('tools');
  return badges;
}

function priceLabel(pricing) {
  if (!pricing) return null;
  if (pricing.input === 0 && pricing.output === 0) return null;
  const fmt = (n) => (n >= 1 ? n.toFixed(2) : n.toFixed(3));
  return `$${fmt(pricing.input)} in · $${fmt(pricing.output)} out / 1M`;
}

function contextLabel(context) {
  if (!context) return null;
  if (context >= 1_000_000) return `${(context / 1_000_000).toFixed(1).replace(/\.0$/, '')}M ctx`;
  if (context >= 1000) return `${Math.round(context / 1000)}K ctx`;
  return `${context} ctx`;
}

function pickerItemFromModel(model, groupLabel) {
  if (model.source === 'hint' || model.disabled) {
    return {
      id: model.id,
      label: model.label || model.id,
      group: groupLabel,
      tag: null,
      badges: [],
      detail: null,
      isFree: false,
      suitable: false,
      disabled: true,
      source: model.source || 'hint',
    };
  }
  const badges = capabilityBadges(model);
  const price = priceLabel(model.pricing);
  const detailParts = [];
  if (model.free) detailParts.push(model.provider === 'ollama' ? 'free · runs locally' : 'free');
  else if (price) detailParts.push(price);
  const ctx = contextLabel(model.context);
  if (ctx) detailParts.push(ctx);
  if (model.source === 'cached') detailParts.push('cached — provider offline');
  return {
    id: model.id,
    label: model.label || shortModelLabel(model.id),
    group: groupLabel,
    tag: model.free ? 'free' : null,
    badges,
    price: model.free ? null : price,
    context: model.context || null,
    detail: detailParts.join(' · ') || null,
    isFree: Boolean(model.free),
    suitable: true,
    disabled: false,
    source: model.source || 'live',
  };
}

// One picker payload: the free-router auto-pick on top, then every configured
// provider's live catalog grouped under its label. Polling is best-effort; on a
// total failure the cached groups (or nothing beyond free-router) are used so the
// picker still opens.
export async function loadModelPickerItems(_driver, { env = process.env, cwd = process.cwd(), currentModel = null, modelMode = 'pinned', pollProviders = pollConfiguredProviders } = {}) {
  const items = [];
  const seen = new Set();

  const hasOpenRouter = hasAnySecret(['OPENROUTER_API_KEY', 'OPEN_ROUTER_API_KEY'], { env });
  items.push({
    id: FREE_ROUTER_ITEM_ID,
    label: 'OpenRouter free router — auto-pick best standard model',
    group: 'Smart routing',
    tag: 'router',
    badges: [],
    detail: hasOpenRouter
      ? 'auto-pick on launch + retry on failure; not pinned'
      : 'needs OPENROUTER_API_KEY in ~/.construct/config.env',
    action: 'free-router',
    configured: hasOpenRouter,
    disabled: !hasOpenRouter,
  });
  seen.add(FREE_ROUTER_ITEM_ID);

  let groups = [];
  try {
    groups = await pollProviders({ env, cwd });
  } catch {
    groups = readProviderCatalogCache() || [];
  }

  for (const group of groups) {
    const sorted = [...group.models].sort(
      (a, b) => Number(Boolean(b.free)) - Number(Boolean(a.free))
        || String(a.label || a.id).localeCompare(String(b.label || b.id)),
    );
    for (const model of sorted) {
      if (seen.has(model.id)) continue;

      // The chat loop always dispatches tools, so a model the provider reports as
      // tool-incapable can only ever error out — drop it from the picker. Only
      // filter when the provider actually told us (toolsKnown); an unknown
      // capability (e.g. a local Ollama tag) stays selectable.
      if (!model.disabled && model.source !== 'hint' && model.toolsKnown === true && !model.tools) {
        seen.add(model.id);
        continue;
      }

      seen.add(model.id);
      items.push(pickerItemFromModel(model, group.label));
    }
  }

  if (currentModel && modelMode !== 'free-router' && !seen.has(currentModel)) {
    seen.add(currentModel);
    items.push(pickerItemFromModel(
      { id: currentModel, label: currentModel, free: false, source: 'live' },
      'Current session',
    ));
  }

  return items;
}

export async function resolveModelPickerSelection(item, { env = process.env } = {}) {
  if (!item) return null;
  if (item.action === 'free-router' || item.id === FREE_ROUTER_ITEM_ID) {
    const modelId = await resolveFreeOpenRouterModel({ env, tier: 'standard' });
    return modelId ? { mode: 'free-router', modelId } : null;
  }
  return { mode: 'pinned', modelId: item.id };
}

export function commitPickerModel(session, selection, { cwd, hostId = 'construct', layers = null } = {}) {
  const normalized = typeof selection === 'string'
    ? { mode: 'pinned', modelId: selection }
    : selection;
  if (!normalized?.modelId && normalized?.mode !== 'free-router') return null;

  session.modelMode = normalized.mode || 'pinned';
  session.model = normalized.modelId;
  session.savedModel = session.modelMode === 'pinned' ? normalized.modelId : null;
  session.modelNotice = null;

  try {
    saveChatConfig({
      host: hostId,
      model: session.modelMode === 'pinned' ? session.model : null,
      modelMode: session.modelMode,
      layers: layers || session.layers,
      thinking: (layers || session.layers)?.thinking,
      permissionMode: session.permissionMode,
      sandbox: session.sandbox,
      ui: session.ui,
    }, { cwd });
  } catch { /* persistence is best-effort */ }
  return normalized;
}

export function pickerSelectedId(session) {
  if (session?.modelMode === 'free-router') return FREE_ROUTER_ITEM_ID;
  return session?.savedModel || session?.model || null;
}

export function formatModelHeader(session) {
  if (session?.modelMode === 'free-router') {
    const slug = session.model ? session.model.replace(/^openrouter\//, '') : '(resolving…)';
    return { label: `free router → ${slug}`, isRouter: true };
  }
  const active = session?.model || '(no model)';
  const saved = session?.savedModel;
  if (saved && saved !== session?.model) {
    return { label: active, savedPin: saved, isRouter: false };
  }
  return { label: active, isRouter: false };
}

function formatPickerLine(item, colors, { selected = false } = {}) {
  const marker = selected ? `${colors.green}●${colors.reset}` : ' ';
  const tag = item.tag ? `${colors.dim} [${item.tag}]${colors.reset}` : '';
  const badges = item.badges?.length ? `${colors.dim} ${item.badges.map((b) => `·${b}`).join(' ')}${colors.reset}` : '';
  const disabled = item.disabled ? `${colors.dim} (unavailable)${colors.reset}` : '';
  const detail = item.detail ? `\n      ${colors.dim}${item.detail}${colors.reset}` : '';
  return `  ${marker} ${item.label || item.id}${tag}${badges}${disabled}${detail}`;
}

export async function promptModelPickerTerminal({
  output,
  colors,
  session,
  rl = null,
  askFn = null,
  env = process.env,
  cwd = process.cwd(),
  hostId = 'construct',
  layers = session?.layers,
} = {}) {
  const items = await loadModelPickerItems(null, {
    env,
    currentModel: session?.model,
    modelMode: session?.modelMode || 'pinned',
  });
  if (!items.length) {
    output.write(`${colors.dim}no models to pick from — set a provider key in ~/.construct/config.env or use /model <id>${colors.reset}\n`);
    return null;
  }

  const selectedId = pickerSelectedId(session);
  output.write(`${colors.bold}select a model${colors.reset}\n`);
  output.write(`${colors.dim}enter a number, or press enter to cancel${colors.reset}\n`);
  const groupCounts = new Map();
  for (const item of items) {
    if (!item.group || item.disabled) continue;
    groupCounts.set(item.group, (groupCounts.get(item.group) || 0) + 1);
  }
  let lastGroup = null;
  items.forEach((item, i) => {
    if (item.group && item.group !== lastGroup) {
      lastGroup = item.group;
      const count = groupCounts.get(item.group);
      const suffix = count ? ` (${count})` : '';
      output.write(`\n${colors.dim}── ${item.group}${suffix} ──${colors.reset}\n`);
    }
    output.write(`${String(i + 1).padStart(2)}.${formatPickerLine(item, colors, { selected: item.id === selectedId })}\n`);
  });

  const prompt = `${colors.green}model #${colors.reset} `;
  const answer = rl
    ? (await new Promise((resolve) => rl.question(prompt, resolve))).trim()
    : askFn
      ? String(await askFn(prompt)).trim()
      : '';
  if (!answer) {
    output.write(`${colors.dim}${rl || askFn ? 'cancelled' : 'pick one with /model <id> or use the Ink UI for search'}${colors.reset}\n`);
    return null;
  }

  const idx = Number(answer) - 1;
  if (!Number.isInteger(idx) || idx < 0 || idx >= items.length) {
    output.write(`${colors.red}invalid selection${colors.reset}\n`);
    return null;
  }

  const item = items[idx];
  if (item.disabled) {
    output.write(`${colors.red}${item.detail || 'model not available'}${colors.reset}\n`);
    return null;
  }

  const selection = await resolveModelPickerSelection(item, { env });
  if (!selection?.modelId && selection?.mode !== 'free-router') {
    output.write(`${colors.red}could not resolve model${colors.reset}\n`);
    return null;
  }

  commitPickerModel(session, selection, { cwd, hostId, layers });
  const label = selection.mode === 'free-router'
    ? `free-router → ${selection.modelId}`
    : selection.modelId;
  output.write(`${colors.green}model set:${colors.reset} ${label} ${colors.dim}(saved)${colors.reset}\n`);
  return selection;
}
