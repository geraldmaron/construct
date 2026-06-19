/**
 * lib/chat/model-picker.mjs — model list data for the construct chat picker.
 *
 * Curates a short list: free-router auto-pick, live OpenRouter free models,
 * configured provider tier defaults, and the active session model. Persistence
 * reuses saveChatConfig from lib/chat/config.mjs.
 */

import { saveChatConfig } from './config.mjs';
import { resolveFirstSecret, hasAnySecret } from '../providers/secret-resolver.mjs';
import { getProviderModelCatalog } from '../model-router.mjs';
import { resolveFreeOpenRouterModel } from '../../apps/chat/engine/models.mjs';
import { filterPickerItems, pickerStartIndex, windowPickerItems } from './list-picker.mjs';

export { filterPickerItems, pickerStartIndex, windowPickerItems };

export const FREE_ROUTER_ITEM_ID = '__free_router__';
const FREE_PICKER_LIMIT = 18;

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
      items.push(catalogItem({
        id,
        label: id,
        name: `${provider.label} · ${tier}`,
        tier,
        configured: true,
        suitable: true,
        isProviderDefault: tier === 'standard',
      }));
    }
  }
  return { items, seen };
}

export async function loadModelPickerItems(_driver, { env = process.env, currentModel = null, modelMode = 'pinned' } = {}) {
  const items = [];
  const seen = new Set();

  const hasOpenRouter = hasAnySecret(['OPENROUTER_API_KEY', 'OPEN_ROUTER_API_KEY'], { env });

  items.push({
    id: FREE_ROUTER_ITEM_ID,
    label: 'OpenRouter free router — auto-pick best standard model',
    tag: 'router',
    detail: hasOpenRouter
      ? 'auto-pick on launch + retry on failure; not pinned'
      : 'needs OPENROUTER_API_KEY in ~/.construct/config.env',
    action: 'free-router',
    configured: hasOpenRouter,
    disabled: !hasOpenRouter,
  });
  seen.add(FREE_ROUTER_ITEM_ID);

  if (hasOpenRouter) {
    try {
      const apiKey = resolveFirstSecret(['OPENROUTER_API_KEY', 'OPEN_ROUTER_API_KEY'], { env });
      if (!apiKey) throw new Error('missing');
      const { pollFreeModels, topForTier } = await import('../model-free-selector.mjs');
      const freeLive = await pollFreeModels(apiKey);
      for (const f of topForTier(freeLive, 'standard', FREE_PICKER_LIMIT)) {
        const id = f.id?.startsWith('openrouter/') ? f.id : `openrouter/${f.id}`;
        if (seen.has(id)) continue;
        seen.add(id);
        items.push(catalogItem({
          id,
          label: shortModelLabel(id),
          name: f.name || id,
          detail: id,
          isFree: true,
          configured: true,
          suitable: true,
        }));
      }
    } catch { /* live free poll is best-effort */ }
  }

  const tierItems = configuredTierPickerItems({ env });
  for (const item of tierItems.items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    items.push(item);
  }

  if (currentModel && modelMode !== 'free-router' && !seen.has(currentModel)) {
    items.push(catalogItem({
      id: currentModel,
      label: currentModel,
      name: 'current session',
      configured: true,
      suitable: true,
    }));
  }

  return sortModelsForPicker(items);
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
  return { label: session?.model || '(no model)', isRouter: false };
}
