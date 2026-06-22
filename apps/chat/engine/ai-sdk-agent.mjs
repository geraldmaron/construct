/**
 * apps/chat/engine/ai-sdk-agent.mjs — the real owned-loop engine (Vercel AI SDK).
 *
 * Lazy-loaded by the launcher only when `construct chat` runs the rich/owned path,
 * so the optional dependencies (`ai`, `@ai-sdk/*`, `zod`) never load in the zero-dep
 * core or in tests of the mapping layer. It resolves a Construct model id (the
 * router's `provider/model` form) to an AI SDK language model through the adapter
 * registry (provider-adapters.mjs), builds the agent tool set from the tool
 * registry, and runs streamText under the turn's compiled execution policy
 * (turn-controls.mjs): the step cap, tool-group / schema budget, output cap, and
 * caching eligibility all derive from the resolved capability profile, so the loop
 * adapts to the model while staying behavior-preserving for hosted-direct. It
 * yields the SDK fullStream parts unchanged; loop-driver.mjs owns the
 * normalization into the event union.
 */

import { listChatModels } from './models.mjs';
import { resolveLanguageModel } from './provider-adapters.mjs';
import { resolveTurnControls } from './turn-controls.mjs';
import { buildSystemPrompt } from '../../../lib/chat/system-prompt.mjs';
import { applyToolBudget } from '../../../lib/mcp/tool-budget.mjs';
import { recordPolicyTelemetry } from '../../../lib/chat/policy-telemetry.mjs';

export async function createAiSdkAgent({ env = process.env, cwd = process.cwd(), model = null, handlers = {}, systemPrompt = '', tools = null, onTelemetry = recordPolicyTelemetry } = {}) {
  const { streamText, stepCountIs } = await import('ai');

  const { buildAgentTools } = await import('./tools/registry.mjs');
  const sdkTools = await buildAgentTools({ env, cwd, handlers, only: tools });

  const messages = [];
  const languageModels = new Map();
  let activeModelId = model;

  async function languageModelFor(modelId) {
    const id = modelId || activeModelId;
    if (!id) {
      const err = new Error('No model selected and no configured provider found. Run `construct models` or set CX_MODEL_STANDARD.');
      err.code = 'PROVIDER_MODEL_UNRESOLVED';
      throw err;
    }
    if (!languageModels.has(id)) {
      languageModels.set(id, await resolveLanguageModel(id, env));
    }
    return languageModels.get(id);
  }

  return {
    sessionId: `construct-${Date.now()}`,
    model,
    listModels: () => listChatModels({ env }),
    async *streamTurn(text, { signal, model: turnModel = null, turnOverlay = null } = {}) {
      if (turnModel) activeModelId = turnModel;
      const languageModel = await languageModelFor(activeModelId);

      const controls = resolveTurnControls({ model: activeModelId, turnOverlay, env });
      if (controls.degraded) {
        onTelemetry({
          kind: 'execution-policy-degraded',
          model: activeModelId,
          capabilityClass: controls.policy?.source?.capabilityClass || 'unknown',
          reasons: controls.policy?.telemetry?.reasons || [],
        });
      }
      const turnTools = applyToolBudget(sdkTools, {
        allowedToolGroups: controls.allowedToolGroups,
        maxToolSchemas: controls.maxToolSchemas,
      });

      // Per-turn routing policy belongs in the SYSTEM role (via buildSystemPrompt),
      // never prepended to the user message: a user-role policy gets echoed in model
      // reasoning and compounds in persisted history.
      messages.push({ role: 'user', content: String(text) });
      const systemText = buildSystemPrompt({ base: systemPrompt || undefined, overlay: turnOverlay });

      const request = {
        model: languageModel,
        tools: turnTools,
        stopWhen: stepCountIs(controls.iterations),
        abortSignal: signal,
        maxRetries: 0,
      };
      if (controls.outputCap) request.maxOutputTokens = controls.outputCap;

      // A cache-eligible provider marks the stable system prefix as a cache
      // breakpoint: the AI SDK maps a single leading system message onto the
      // provider's system field, so the request stays output-identical and only the
      // cache_control annotation is added. Every other provider keeps the plain
      // system string — today's exact request shape.
      if (controls.cacheEligible) {
        const providerNs = String(activeModelId || '').split('/')[0] || 'anthropic';
        request.messages = [
          { role: 'system', content: systemText, providerOptions: { [providerNs]: { cacheControl: { type: 'ephemeral' } } } },
          ...messages,
        ];
      } else {
        request.system = systemText;
        request.messages = messages;
      }

      const result = streamText(request);
      for await (const part of result.fullStream) yield part;
      // Persist the assistant turn (incl. tool exchanges) so the next prompt has history.
      try {
        const response = await result.response;
        if (Array.isArray(response?.messages)) messages.push(...response.messages);
        // Surface the model that actually answered — the OpenRouter free router
        // resolves to an underlying model id, not the "openrouter/free" alias.
        const resolved = response?.modelId;
        if (resolved && resolved !== activeModelId && !String(activeModelId).endsWith(resolved)) {
          yield { type: 'model-resolved', model: resolved };
        }
      } catch { /* history append is best-effort */ }
    },
  };
}
