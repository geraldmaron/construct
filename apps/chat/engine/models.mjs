/**
 * apps/chat/engine/models.mjs — model and provider resolution for the owned loop.
 *
 * The owned loop is provider-agnostic (ADR-0041/ADR-0003): model choice is never
 * hardcoded. This module reuses the core router (lib/model-router.mjs) so the chat
 * surface, the orchestration worker, and the embedded contract all resolve models
 * the same way. resolveChatModelSelection validates CX_MODEL pins against live
 * credential detection; resolveChatModelSelectionAsync also probes Copilot session
 * exchange so a bad token falls through before the first turn.
 */

import {
  getProviderModelCatalog,
  describeModelFamily,
  resolveValidatedChatModel,
  isChatModelAvailable,
} from '../../../lib/model-router.mjs';
import { resolveFirstSecret } from '../../../lib/providers/secret-resolver.mjs';

export function listChatModels({ env = process.env } = {}) {
  const { providers } = getProviderModelCatalog({ env });
  const models = [];
  const seen = new Set();
  for (const provider of providers) {
    for (const tier of ['reasoning', 'standard', 'fast']) {
      for (const id of provider.options?.[tier] || []) {
        if (seen.has(id)) continue;
        seen.add(id);
        models.push({
          id,
          label: id,
          provider: provider.id,
          configured: provider.configured,
          local: provider.local === true,
          suitable: true,
          tier,
          available: isChatModelAvailable(id, { env }).ok,
        });
      }
    }
  }
  return models.sort((a, b) => Number(b.configured) - Number(a.configured) || a.id.localeCompare(b.id));
}

export function recommendChatModel({ env = process.env } = {}) {
  const { providers } = getProviderModelCatalog({ env });
  const configured = providers.find((p) => p.configured);
  if (!configured) return null;
  const id = configured.tiers?.standard || configured.tiers?.fast || null;
  if (!id) return null;
  const check = isChatModelAvailable(id, { env });
  if (!check.ok) return null;
  return { id, reason: `configured provider ${configured.label}` };
}

export function resolveChatModelSelection({ env = process.env, requested = null, excludeFamilies = [] } = {}) {
  return resolveValidatedChatModel({ env, requested, excludeFamilies });
}

export async function resolveFreeOpenRouterModel({ env = process.env, tier = 'standard', exclude = [] } = {}) {
  const apiKey = resolveFirstSecret(['OPENROUTER_API_KEY', 'OPEN_ROUTER_API_KEY'], { env });
  if (!apiKey) return null;
  const excludeSet = new Set(Array.isArray(exclude) ? exclude : []);
  const { pollFreeModels, topForTier } = await import('../../../lib/model-free-selector.mjs');
  const freeModels = await pollFreeModels(apiKey);
  for (const candidate of topForTier(freeModels, tier, 20)) {
    const modelId = candidate.id.startsWith('openrouter/') ? candidate.id : `openrouter/${candidate.id}`;
    if (excludeSet.has(modelId)) continue;
    if (isChatModelAvailable(modelId, { env }).ok) return modelId;
  }
  return null;
}

export async function resolveSessionModel(session, { env = process.env, exclude = [], tier = 'standard' } = {}) {
  if (session?.modelMode === 'free-router') {
    const merged = [...new Set([...getExcludeFromSession(session), ...exclude])];
    return resolveFreeOpenRouterModel({ env, tier, exclude: merged });
  }
  return session?.model || session?.savedModel || null;
}

function getExcludeFromSession(session) {
  if (!session?.failedModels) return [];
  return session.failedModels instanceof Set ? [...session.failedModels] : [];
}

export async function resolveChatModelSelectionAsync({
  env = process.env,
  requested = null,
  fetchImpl = fetch,
} = {}) {
  let resolution = resolveValidatedChatModel({ env, requested });
  if (!resolution.id?.startsWith('github-copilot/')) return resolution;

  const { preflightCopilotSession } = await import('../../../lib/providers/copilot-auth.mjs');
  const probe = await preflightCopilotSession({ fetchImpl });
  if (probe.ok) return resolution;

  const fallback = resolveValidatedChatModel({ env, requested: null, excludeFamilies: ['github-copilot'] });
  if (fallback.id) {
    return {
      ...fallback,
      notice: `GitHub Copilot session failed (${probe.message}). Using ${fallback.id}.`,
    };
  }
  return {
    id: null,
    source: null,
    notice: `GitHub Copilot session failed: ${probe.message}`,
    rejected: resolution.rejected,
  };
}

export function resolveChatModel(opts = {}) {
  return resolveChatModelSelection(opts).id;
}

export function describeChatModel(modelId, { env = process.env } = {}) {
  return describeModelFamily(modelId, { env });
}
