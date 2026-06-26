/**
 * lib/chat/model-picker.mjs — model list data for the construct chat picker.
 *
 * Curates a short list: free-router auto-pick, live OpenRouter free models,
 * configured provider tier defaults, and the active session model. Persistence
 * reuses saveChatConfig from lib/chat/config.mjs.
 */

import { saveChatConfig } from './config.mjs';
import { getUserEnvPath } from '../env-config.mjs';
import { hasAnySecret } from '../providers/secret-resolver.mjs';
import { getProviderModelCatalog, isChatModelAvailable, resolveValidatedChatModel } from '../model-router.mjs';
import {
  pollConfiguredProviders,
  readProviderCatalogCache,
} from '../models/provider-poll.mjs';
import { resolveFreeOpenRouterModel } from '../../apps/chat/engine/models.mjs';
import { filterPickerItems, pickerStartIndex, windowPickerItems } from './list-picker.mjs';
import { curatePollModelsForPicker } from './model-picker-filter.mjs';
import { loadModelsCatalogContext } from '../models/catalog.mjs';

export { filterPickerItems, pickerStartIndex, windowPickerItems };

export const FREE_ROUTER_ITEM_ID = '__free_router__';
export const FOLLOW_TIER_ITEM_ID = '__follow_tier__';

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

  // The OpenRouter free router answers from whatever free model is available, so
  // quality and behavior vary turn to turn — say so before it is selected.
  if (/^openrouter\/openrouter\/(free|auto)\b/.test(String(model.id))) {
    detailParts.push('variable quality — routes to a random free model');
  }
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
export async function loadModelPickerItems(_driver, { env = process.env, cwd = process.cwd(), currentModel = null, modelMode = 'follow-tier', pollProviders = pollConfiguredProviders } = {}) {
  const items = [];
  const seen = new Set();

  const tierDefault = resolveValidatedChatModel({ env, requested: null });
  items.push({
    id: FOLLOW_TIER_ITEM_ID,
    label: 'Use tier default (CX_MODEL_STANDARD)',
    group: 'Smart routing',
    tag: 'tier',
    badges: [],
    detail: tierDefault?.id
      ? `follows ${tierDefault.id} — updates when CX_MODEL_* changes`
      : 'resolves from CX_MODEL_STANDARD in config.env',
    action: 'follow-tier',
    configured: Boolean(tierDefault?.id),
    disabled: !tierDefault?.id,
  });
  seen.add(FOLLOW_TIER_ITEM_ID);

  const hasOpenRouter = hasAnySecret(['OPENROUTER_API_KEY', 'OPEN_ROUTER_API_KEY'], { env });
  items.push({
    id: FREE_ROUTER_ITEM_ID,
    label: 'OpenRouter free router — auto-pick best standard model',
    group: 'Smart routing',
    tag: 'router',
    badges: [],
    detail: hasOpenRouter
      ? 'auto-picks a free model + retries on failure; not pinned — quality varies'
      : 'needs OPENROUTER_API_KEY in ~/.config/construct/config.env',
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

  const { modelsConfig } = loadModelsCatalogContext({ cwd, env });

  for (const group of groups) {
    const curated = curatePollModelsForPicker(group.models, {
      groupId: group.id,
      env,
      cwd,
      currentModel,
      modelsConfig,
    });
    const sorted = [...curated].sort(
      (a, b) => Number(Boolean(b.free)) - Number(Boolean(a.free))
        || String(a.label || a.id).localeCompare(String(b.label || b.id)),
    );
    for (const model of sorted) {
      if (seen.has(model.id)) continue;
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
  if (item.action === 'follow-tier' || item.id === FOLLOW_TIER_ITEM_ID) {
    const resolved = resolveValidatedChatModel({ env, requested: null });
    return resolved?.id ? { mode: 'follow-tier', modelId: resolved.id } : null;
  }
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
  if (!normalized?.modelId && normalized?.mode !== 'free-router' && normalized?.mode !== 'follow-tier') return null;

  session.modelMode = normalized.mode || 'follow-tier';
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
  if (session?.modelMode === 'follow-tier') return FOLLOW_TIER_ITEM_ID;
  return session?.savedModel || session?.model || null;
}

export function formatModelHeader(session) {
  if (session?.modelMode === 'free-router') {
    const slug = session.model ? session.model.replace(/^openrouter\//, '') : '(resolving…)';
    return { label: `free router → ${slug}`, isRouter: true };
  }
  if (session?.modelMode === 'follow-tier') {
    const slug = session.model ? session.model.replace(/^openrouter\//, '') : '(tier default)';
    return { label: `${slug} (tier)`, isRouter: false, followTier: true };
  }
  const active = session?.model || '(no model)';
  const saved = session?.savedModel;
  if (saved && saved !== session?.model) {
    return { label: active, savedPin: saved, isRouter: false };
  }
  return { label: active, isRouter: false };
}

function formatPickerLine(item, colors, { selected = false, compact = false } = {}) {
  const marker = selected ? `${colors.green}▸${colors.reset}` : ' ';
  const tag = item.tag ? `${colors.dim} [${item.tag}]${colors.reset}` : '';
  const badges = item.badges?.length ? `${colors.dim} ${item.badges.map((b) => `·${b}`).join(' ')}${colors.reset}` : '';
  const disabled = item.disabled ? `${colors.dim} (unavailable)${colors.reset}` : '';
  if (compact) {
    const detail = item.detail ? ` ${colors.dim}— ${item.detail}${colors.reset}` : '';
    return `${marker} ${colors.text}${item.label || item.id}${colors.reset}${tag}${badges}${detail}${disabled}`;
  }
  const detail = item.detail ? `\n      ${colors.dim}${item.detail}${colors.reset}` : '';
  return `  ${marker} ${item.label || item.id}${tag}${badges}${disabled}${detail}`;
}

async function promptModelPickerNumbered({
  output,
  colors,
  items,
  selectedId,
  rl,
  askFn,
  env,
  cwd,
  hostId,
  layers,
  session,
}) {
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
    output.write(`${colors.dim}${rl || askFn ? 'cancelled' : 'pick one with /model <id>'}${colors.reset}\n`);
    return null;
  }

  const idx = Number(answer) - 1;
  if (!Number.isInteger(idx) || idx < 0 || idx >= items.length) {
    output.write(`${colors.red}invalid selection${colors.reset}\n`);
    return null;
  }

  return items[idx];
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
  pollProviders = pollConfiguredProviders,
} = {}) {
  if (output?.isTTY) {
    output.write(`${colors.dim}loading models…${colors.reset}\n`);
  }
  const items = await loadModelPickerItems(null, {
    env,
    cwd,
    currentModel: session?.model,
    modelMode: session?.modelMode || 'follow-tier',
    pollProviders,
  });
  if (!items.length) {
    output.write(`${colors.dim}no models to pick from — set a provider key in ${getUserEnvPath()} or use /model <id>${colors.reset}\n`);
    return null;
  }

  const selectable = items.filter((item) => !item.disabled);
  if (output?.isTTY && selectable.length < items.length) {
    output.write(`${colors.dim}Showing ${selectable.length} curated models. Set models.visibility.mode to all_configured in construct.config.json for the full OpenRouter catalog.${colors.reset}\n`);
  }

  const selectedId = pickerSelectedId(session);
  let item = null;
  const interactive = Boolean(rl?.input?.isTTY && output?.isTTY);

  if (interactive) {
    const { runInteractiveListPicker } = await import('./tui/interactive-list-picker.mjs');
    const canPauseRl = typeof rl.pause === 'function';
    if (canPauseRl) {
      rl.pause();
      rl.input?.resume?.();
    }
    try {
      item = await runInteractiveListPicker({
        input: rl.input,
        output,
        colors,
        title: 'select a model',
        items,
        selectedId,
        windowSize: 16,
        formatItem: (entry, ctx) => formatPickerLine(entry, colors, { ...ctx, compact: true }),
      });
    } finally {
      if (canPauseRl) {
        rl.resume();
        rl.prompt(true);
      }
    }
    if (!item) {
      output.write(`${colors.dim}cancelled${colors.reset}\n`);
      return null;
    }
  } else {
    item = await promptModelPickerNumbered({
      output,
      colors,
      items,
      selectedId,
      rl,
      askFn,
      env,
      cwd,
      hostId,
      layers,
      session,
    });
    if (!item) return null;
  }

  if (item.disabled) {
    output.write(`${colors.red}${item.detail || 'model not available'}${colors.reset}\n`);
    return null;
  }

  const selection = await resolveModelPickerSelection(item, { env });
  if (!selection?.modelId && selection?.mode !== 'free-router' && selection?.mode !== 'follow-tier') {
    output.write(`${colors.red}could not resolve model${colors.reset}\n`);
    return null;
  }

  commitPickerModel(session, selection, { cwd, hostId, layers });
  const label = selection.mode === 'free-router'
    ? `free-router → ${selection.modelId}`
    : selection.mode === 'follow-tier'
      ? `tier default → ${selection.modelId}`
      : selection.modelId;
  output.write(`${colors.green}model set:${colors.reset} ${label} ${colors.dim}(saved)${colors.reset}\n`);
  return selection;
}
