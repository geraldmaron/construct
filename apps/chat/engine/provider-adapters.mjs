/**
 * apps/chat/engine/provider-adapters.mjs — centralized provider execution adapters
 * (construct-6zga.1.3).
 *
 * One registry, keyed by provider group, owns provider execution. Each adapter
 * owns its own credential resolution, base URL, native model-id translation, auth
 * scheme, and AI SDK provider construction; the dispatcher does no
 * provider/model-prefix behavior branch — it extracts the structural provider
 * group (the model id's first segment, the same identity lib/models keys on) and
 * looks the adapter up. Adding a compatible provider is a registry entry plus
 * matrix fixtures, never a dispatch edit.
 *
 * Public model ids are preserved: the native id handed to the SDK is the model id
 * with its group segment stripped, so anthropic/claude-x → claude-x and
 * openrouter/anthropic/claude-x → anthropic/claude-x (OpenRouter's own id).
 * Credentials resolve through the shared secret resolver (env, dotenv, shell rc,
 * 1Password op:// refs); a missing key fails fast with a remediation hint.
 */
import { resolveFirstSecret } from '../../../lib/providers/secret-resolver.mjs';
import { providerGroupForModel } from '../../../lib/models/execution-capability-profile.mjs';

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';

function envKey(env, ...names) {
  return resolveFirstSecret(names, { env, allowAmbient: env === process.env });
}

function missingKey(provider, varName) {
  const err = new Error(`No credentials for ${provider}: set ${varName} (or run \`construct creds\`) and retry.`);
  err.code = 'PROVIDER_KEY_MISSING';
  return err;
}

// Adapter descriptors. `describe` is the serializable contract (auth scheme,
// protocol, credential env, base URL source) for tracing and conformance fixtures;
// `createModel` builds the AI SDK handle from the native id. The @ai-sdk/* imports
// stay lazy so the zero-dep core never loads them.

const ADAPTERS = {
  anthropic: {
    id: 'anthropic',
    auth: 'api_key',
    protocol: 'anthropic-messages',
    credentialEnv: ['ANTHROPIC_API_KEY'],
    baseURL: 'default',
    async createModel({ nativeModelId, env }) {
      const apiKey = envKey(env, 'ANTHROPIC_API_KEY');
      if (!apiKey) throw missingKey('Anthropic', 'ANTHROPIC_API_KEY');
      const { createAnthropic } = await import('@ai-sdk/anthropic');
      return createAnthropic({ apiKey })(nativeModelId);
    },
  },
  openai: {
    id: 'openai',
    auth: 'api_key',
    protocol: 'openai-chat-completions',
    credentialEnv: ['OPENAI_API_KEY'],
    baseURL: 'default',
    async createModel({ nativeModelId, env }) {
      const apiKey = envKey(env, 'OPENAI_API_KEY');
      if (!apiKey) throw missingKey('OpenAI', 'OPENAI_API_KEY');
      const { createOpenAI } = await import('@ai-sdk/openai');
      return createOpenAI({ apiKey })(nativeModelId);
    },
  },
  openrouter: {
    id: 'openrouter',
    auth: 'api_key',
    protocol: 'openai-compatible',
    credentialEnv: ['OPENROUTER_API_KEY', 'OPEN_ROUTER_API_KEY'],
    baseURL: OPENROUTER_BASE,
    async createModel({ nativeModelId, env }) {
      const apiKey = envKey(env, 'OPENROUTER_API_KEY', 'OPEN_ROUTER_API_KEY');
      if (!apiKey) throw missingKey('OpenRouter', 'OPENROUTER_API_KEY');
      const { createOpenAICompatible } = await import('@ai-sdk/openai-compatible');
      return createOpenAICompatible({ name: 'openrouter', baseURL: OPENROUTER_BASE, apiKey })(nativeModelId);
    },
  },
  ollama: {
    id: 'ollama',
    auth: 'none',
    protocol: 'openai-compatible',
    credentialEnv: [],
    baseURL: 'env:OLLAMA_BASE_URL',
    async createModel({ modelId, nativeModelId, env }) {
      const { isOllamaModelInstalled, formatOllamaModelMissingMessage } = await import('../../../lib/ollama/installed-models.mjs');
      if (isOllamaModelInstalled(modelId, { env }) === false) {
        const err = new Error(formatOllamaModelMissingMessage(nativeModelId));
        err.code = 'OLLAMA_MODEL_NOT_PULLED';
        throw err;
      }
      const baseURL = envKey(env, 'OLLAMA_BASE_URL') || 'http://localhost:11434/v1';
      const { createOpenAICompatible } = await import('@ai-sdk/openai-compatible');
      return createOpenAICompatible({ name: 'ollama', baseURL, apiKey: 'ollama' })(nativeModelId);
    },
  },
  local: {
    id: 'local',
    auth: 'api_key',
    protocol: 'openai-compatible',
    credentialEnv: ['LOCAL_LLM_API_KEY'],
    baseURL: 'env:LOCAL_LLM_BASE_URL',
    async createModel({ nativeModelId, env }) {
      const baseURL = envKey(env, 'LOCAL_LLM_BASE_URL');
      if (!baseURL) throw missingKey('local OpenAI-compatible server', 'LOCAL_LLM_BASE_URL');
      const { createOpenAICompatible } = await import('@ai-sdk/openai-compatible');
      return createOpenAICompatible({ name: 'local', baseURL, apiKey: envKey(env, 'LOCAL_LLM_API_KEY') || 'local' })(nativeModelId);
    },
  },
  'github-copilot': {
    id: 'github-copilot',
    auth: 'oauth',
    protocol: 'openai-chat-completions',
    credentialEnv: [],
    baseURL: 'copilot',
    async createModel({ nativeModelId }) {
      const { getCopilotToken, copilotApiHeaders, COPILOT_API_BASE } = await import('../../../lib/providers/copilot-auth.mjs');
      const { createOpenAICompatible } = await import('@ai-sdk/openai-compatible');
      const copilotFetch = async (url, init = {}) => {
        const token = await getCopilotToken();
        const headers = new Headers(init.headers);
        for (const [key, value] of Object.entries(copilotApiHeaders())) headers.set(key, value);
        headers.set('Authorization', `Bearer ${token}`);
        return fetch(url, { ...init, headers });
      };
      return createOpenAICompatible({ name: 'github-copilot', baseURL: COPILOT_API_BASE, apiKey: 'via-fetch', fetch: copilotFetch })(nativeModelId);
    },
  },
};

export function getProviderAdapter(group) {
  return ADAPTERS[group] || null;
}

// Serializable adapter contract for tracing and conformance fixtures (no secrets,
// no SDK handles) — the metadata a new provider must register.

export function describeProviderAdapters() {
  return Object.values(ADAPTERS).map((a) => ({
    id: a.id,
    auth: a.auth,
    protocol: a.protocol,
    credentialEnv: a.credentialEnv,
    baseURL: a.baseURL,
  }));
}

export function nativeModelId(modelId, group = providerGroupForModel(modelId)) {
  return String(modelId).slice(group.length + 1);
}

/**
 * Map a Construct "provider/model" id onto an AI SDK language model via the
 * adapter registry. No provider/model-prefix behavior branch: the group is a
 * structural key, the adapter owns the behavior.
 */
export async function resolveLanguageModel(modelId, env) {
  if (!modelId) {
    const err = new Error('No model selected and no configured provider found. Run `construct models` or set CX_MODEL_STANDARD.');
    err.code = 'PROVIDER_MODEL_UNRESOLVED';
    throw err;
  }
  const group = providerGroupForModel(modelId);
  const adapter = ADAPTERS[group];
  if (!adapter) {
    const err = new Error(`Provider for model '${modelId}' is not wired into the owned loop yet. Try an anthropic/, openai/, openrouter/, ollama/, local/, or github-copilot/ model.`);
    err.code = 'PROVIDER_UNSUPPORTED';
    throw err;
  }
  return adapter.createModel({ modelId, nativeModelId: nativeModelId(modelId, group), env });
}
