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
import { configureAiSdkRuntime } from '../../../lib/chat/ai-sdk-runtime.mjs';
import { applyToolBudget } from '../../../lib/mcp/tool-budget.mjs';
import { recordPolicyTelemetry } from '../../../lib/chat/policy-telemetry.mjs';
import { maybeCompact, estimateTextTokens, messageText } from '../../../lib/chat/context-compactor.mjs';

// Real summarization of the compactible layers (tool results, prior assistant
// reasoning) the contract elides, run on the same language model as the turn.
// Bounded output and zero retries keep the once-per-compaction cost small; a throw
// is caught upstream and falls back to the deterministic extractive summary, so a
// summarizer failure degrades fidelity without breaking the turn.

function makeSummarizer({ generateText, languageModel, signal }) {
  return async (text, meta = {}) => {
    const { text: summary } = await generateText({
      model: languageModel,
      system: 'Compress earlier agent work into a faithful, terse recap for context continuation. Preserve decisions, findings, file paths, identifiers, and unresolved threads. Never invent facts. No preamble.',
      prompt: `Summarize these ${meta.segmentCount || 'earlier'} turn(s) of an agent working in a repository. Use compact bullets, keep concrete identifiers, stay under 200 words:\n\n${text}`,
      maxOutputTokens: 512,
      maxRetries: 0,
      abortSignal: signal,
    });
    return summary;
  };
}

export async function createAiSdkAgent({ env = process.env, cwd = process.cwd(), model = null, handlers = {}, systemPrompt = '', tools = null, onTelemetry = recordPolicyTelemetry } = {}) {
  configureAiSdkRuntime();
  const { streamText, stepCountIs, generateText } = await import('ai');

  const { buildAgentTools } = await import('./tools/registry.mjs');
  const sdkTools = await buildAgentTools({ env, cwd, handlers, only: tools });

  const messages = [];
  const languageModels = new Map();
  let activeModelId = model;
  let contextTokens = 0;

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
        request.allowSystemInMessages = true;
      } else {
        request.system = systemText;
        request.messages = messages;
      }

      request.onError = () => {};
      const result = streamText(request);

      // The compaction trigger needs the current context SIZE, which is the last
      // model call's per-step input (system + full history), not the turn's
      // aggregate input — totalUsage sums input across tool steps and would
      // over-count a multi-step turn, tripping compaction below the real budget.
      // Prefer the last finish-step's per-call usage; fall back to the aggregate
      // only when the host reports no per-step usage. Host numbers only, no split.
      let lastStepUsage = null;
      let aggregateUsage = null;
      for await (const part of result.fullStream) {
        if (part.type === 'finish-step' && part.usage) lastStepUsage = part.usage;
        if (part.type === 'finish') aggregateUsage = part.totalUsage || part.usage || aggregateUsage;
        yield part;
      }
      const turnUsage = lastStepUsage || aggregateUsage;

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

      // The next turn's context ≈ this turn's input (system + full history) plus the
      // output just appended. When that crosses the policy's continuation trigger,
      // compact without silent loss. Behavior-preserving: hosted only crosses near
      // its ~150k budget, so short conversations are never touched. Compaction is
      // best-effort — any failure leaves the live history intact.
      const input = Number(turnUsage?.inputTokens) || 0;
      const output = Number(turnUsage?.outputTokens) || 0;
      if (input || output) contextTokens = input + output;

      const trigger = controls.continuation?.triggerTokens || null;
      if (trigger && contextTokens >= trigger) {
        try {
          const outcome = await maybeCompact({
            messages,
            systemText,
            triggerTokens: trigger,
            contextTokens,
            summarize: makeSummarizer({ generateText, languageModel, signal }),
          });
          if (outcome.packet) yield { type: 'context-continuation', packet: outcome.packet, compacted: outcome.compacted };
          if (outcome.notice) {
            yield { type: 'context-notice', level: outcome.blocker ? 'warn' : 'info', code: outcome.blocker ? 'context-blocker' : 'context-compacted', message: outcome.notice };
          }
          if (outcome.compacted && Array.isArray(outcome.messages)) {
            messages.length = 0;
            messages.push(...outcome.messages);
            contextTokens = estimateTextTokens(systemText) + messages.reduce((n, m) => n + estimateTextTokens(messageText(m)), 0);
          }
        } catch { /* compaction must never break a turn */ }
      }
    },
  };
}
