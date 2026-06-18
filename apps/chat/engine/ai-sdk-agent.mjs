/**
 * apps/chat/engine/ai-sdk-agent.mjs — the real owned-loop engine (Vercel AI SDK).
 *
 * Lazy-loaded by the launcher only when `construct chat` runs the rich/owned path,
 * so the optional dependencies (`ai`, `@ai-sdk/*`, `zod`) never load in the zero-dep
 * core or in tests of the mapping layer. It maps a Construct model id (the router's
 * `provider/model` form) onto an AI SDK language model, builds the agent tool set
 * from the tool registry, and runs streamText with a step cap so the loop iterates
 * tool calls until the model stops or the cap is hit. It yields the SDK fullStream
 * parts unchanged; loop-driver.mjs owns the normalization into the event union.
 *
 * Provider mapping covers the router's families: Anthropic and OpenAI direct, and
 * everything OpenAI-compatible (OpenRouter, Ollama, local servers) via one
 * compatible provider keyed by base URL. GitHub Copilot uses its OAuth device-flow
 * session token (lib/providers/copilot-auth.mjs), not an API key. Credentials are
 * resolved through the shared secret resolver (env, dotenv, shell rc, 1Password
 * op:// refs); a missing key fails fast with a remediation hint, not an opaque 401.
 */

import { listChatModels } from './models.mjs';
import { resolveFirstSecret } from '../../../lib/providers/secret-resolver.mjs';

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';

// Resolve through the shared secret resolver so env, the dotenv files, shell rc
// exports, and 1Password op:// references all work the same here as in the
// worker and the router. Non-secret settings (base URLs, ports) resolve through
// the same path and simply pass through when they are plain values.

function envKey(env, ...names) {
  return resolveFirstSecret(names, { env });
}

function missingKey(provider, varName) {
  const err = new Error(`No credentials for ${provider}: set ${varName} (or run \`construct creds\`) and retry.`);
  err.code = 'PROVIDER_KEY_MISSING';
  return err;
}

// Map "provider/model" (router form) onto an AI SDK language model. The leading
// segment selects the provider; the remainder is the provider-native model id.

async function resolveLanguageModel(modelId, env) {
  if (!modelId) {
    const err = new Error('No model selected and no configured provider found. Run `construct models` or set CX_MODEL_STANDARD.');
    err.code = 'PROVIDER_MODEL_UNRESOLVED';
    throw err;
  }

  if (/^anthropic\//.test(modelId)) {
    const apiKey = envKey(env, 'ANTHROPIC_API_KEY');
    if (!apiKey) throw missingKey('Anthropic', 'ANTHROPIC_API_KEY');
    const { createAnthropic } = await import('@ai-sdk/anthropic');
    return createAnthropic({ apiKey })(modelId.replace(/^anthropic\//, ''));
  }

  if (/^openai\//.test(modelId)) {
    const apiKey = envKey(env, 'OPENAI_API_KEY');
    if (!apiKey) throw missingKey('OpenAI', 'OPENAI_API_KEY');
    const { createOpenAI } = await import('@ai-sdk/openai');
    return createOpenAI({ apiKey })(modelId.replace(/^openai\//, ''));
  }

  if (/^openrouter\//.test(modelId)) {
    const apiKey = envKey(env, 'OPENROUTER_API_KEY', 'OPEN_ROUTER_API_KEY');
    if (!apiKey) throw missingKey('OpenRouter', 'OPENROUTER_API_KEY');
    const { createOpenAICompatible } = await import('@ai-sdk/openai-compatible');
    const provider = createOpenAICompatible({ name: 'openrouter', baseURL: OPENROUTER_BASE, apiKey });
    return provider(modelId.replace(/^openrouter\//, ''));
  }

  if (/^ollama\//.test(modelId)) {
    const baseURL = envKey(env, 'OLLAMA_BASE_URL') || 'http://localhost:11434/v1';
    const { createOpenAICompatible } = await import('@ai-sdk/openai-compatible');
    const provider = createOpenAICompatible({ name: 'ollama', baseURL, apiKey: 'ollama' });
    return provider(modelId.replace(/^ollama\//, ''));
  }

  if (/^local\//.test(modelId)) {
    const baseURL = envKey(env, 'LOCAL_LLM_BASE_URL');
    if (!baseURL) throw missingKey('local OpenAI-compatible server', 'LOCAL_LLM_BASE_URL');
    const { createOpenAICompatible } = await import('@ai-sdk/openai-compatible');
    const provider = createOpenAICompatible({ name: 'local', baseURL, apiKey: envKey(env, 'LOCAL_LLM_API_KEY') || 'local' });
    return provider(modelId.replace(/^local\//, ''));
  }

  if (/^github-copilot\//.test(modelId)) {
    // Copilot uses an OAuth device-flow session token (lib/providers/copilot-auth.mjs),
    // not an API key. Inject a fresh session token per request so a refresh mid-session
    // is transparent, and send the editor/integration headers the endpoint requires.
    const { getCopilotToken, copilotApiHeaders, COPILOT_API_BASE } = await import('../../../lib/providers/copilot-auth.mjs');
    const { createOpenAICompatible } = await import('@ai-sdk/openai-compatible');
    const copilotFetch = async (url, init = {}) => {
      const token = await getCopilotToken();
      const headers = new Headers(init.headers);
      for (const [key, value] of Object.entries(copilotApiHeaders())) headers.set(key, value);
      headers.set('Authorization', `Bearer ${token}`);
      return fetch(url, { ...init, headers });
    };
    const provider = createOpenAICompatible({ name: 'github-copilot', baseURL: COPILOT_API_BASE, apiKey: 'via-fetch', fetch: copilotFetch });
    return provider(modelId.replace(/^github-copilot\//, ''));
  }

  const err = new Error(`Provider for model '${modelId}' is not wired into the owned loop yet. Try an anthropic/, openai/, openrouter/, ollama/, local/, or github-copilot/ model.`);
  err.code = 'PROVIDER_UNSUPPORTED';
  throw err;
}

const DEFAULT_SYSTEM = 'You are Construct, a transparent terminal coding agent. Use the provided tools to inspect and edit the workspace. Explain your reasoning and keep actions scoped to the request.';

export async function createAiSdkAgent({ env = process.env, cwd = process.cwd(), model = null, handlers = {}, systemPrompt = '', tools = null } = {}) {
  const { streamText, stepCountIs } = await import('ai');
  const languageModel = await resolveLanguageModel(model, env);

  const { buildAgentTools } = await import('./tools/registry.mjs');
  const sdkTools = await buildAgentTools({ env, cwd, handlers, only: tools });

  const maxSteps = Number(env.CX_CHAT_MAX_STEPS) > 0 ? Number(env.CX_CHAT_MAX_STEPS) : 16;
  const messages = [];

  return {
    sessionId: `construct-${Date.now()}`,
    model,
    listModels: () => listChatModels({ env }),
    async *streamTurn(text, { signal } = {}) {
      messages.push({ role: 'user', content: text });
      const result = streamText({
        model: languageModel,
        system: systemPrompt || DEFAULT_SYSTEM,
        messages,
        tools: sdkTools,
        stopWhen: stepCountIs(maxSteps),
        abortSignal: signal,
      });
      for await (const part of result.fullStream) yield part;
      // Persist the assistant turn (incl. tool exchanges) so the next prompt has history.
      try {
        const response = await result.response;
        if (Array.isArray(response?.messages)) messages.push(...response.messages);
      } catch { /* history append is best-effort */ }
    },
  };
}
