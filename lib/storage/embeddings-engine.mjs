/**
 * lib/storage/embeddings-engine.mjs — Model-agnostic embedding engine.
 *
 * Reads CONSTRUCT_EMBEDDING_MODEL env var and delegates to the appropriate adapter.
 * All adapters return: { embedding: Float32Array, model: string, dimensions: number }
 *
 * Supported models:
 *   - local    → ONNX Transformers (Xenova/all-MiniLM-L6-v2, 384d)
 *   - openai   → OpenAI API (text-embedding-3-small, 1536d)
 *   - ollama   → Ollama server (nomic-embed-text, 768d)
 *   - hashing  → Legacy deterministic hash (256d) — fallback only
 */

const ADAPTERS = {
  local: () => import('./embeddings-local.mjs'),
  'local-onnx': () => import('./embeddings-local.mjs'),
  openai: () => import('./embeddings-openai.mjs'),
  ollama: () => import('./embeddings-ollama.mjs'),
  hashing: () => import('./embeddings-legacy.mjs'),
};

const DEFAULT_MODEL = 'local';

/**
 * Embed a single text string using the configured model.
 * @param {string} text
 * @param {{ env?: object }} opts
 * @returns {Promise<{ embedding: Float32Array, model: string, dimensions: number }>}
 */
export async function embedText(text, { env = process.env } = {}) {
  const modelId = (env.CONSTRUCT_EMBEDDING_MODEL || DEFAULT_MODEL).toLowerCase();
  const loader = ADAPTERS[modelId] || ADAPTERS.hashing;
  const { embed } = await loader();
  return embed(text, { env });
}

/**
 * Embed a batch of texts. Uses model-native batching when available.
 * @param {string[]} texts
 * @param {{ env?: object }} opts
 * @returns {Promise<{ embedding: Float32Array, model: string, dimensions: number }[]>}
 */
export async function embedBatch(texts, { env = process.env } = {}) {
  const modelId = (env.CONSTRUCT_EMBEDDING_MODEL || DEFAULT_MODEL).toLowerCase();
  const loader = ADAPTERS[modelId] || ADAPTERS.hashing;
  const { embedBatch } = await loader();
  return embedBatch(texts, { env });
}

/**
 * Return metadata about the active embedding model.
 * @param {{ env?: object }} opts
 * @returns {Promise<{ id: string, model: string, provider: string, dimensions: number }>}
 */
export async function getEmbeddingModelInfo({ env = process.env } = {}) {
  const modelId = (env.CONSTRUCT_EMBEDDING_MODEL || DEFAULT_MODEL).toLowerCase();
  const loader = ADAPTERS[modelId] || ADAPTERS.hashing;
  const { getModelInfo } = await loader();
  return getModelInfo({ env });
}

/**
 * Return all available embedding model options.
 * @returns {Array<{ id: string, provider: string, model: string, dimensions: number, description: string }>}
 */
export function getAvailableModels() {
  return [
    { id: 'local', provider: 'onnx', model: 'Xenova/all-MiniLM-L6-v2', dimensions: 384, description: 'Free, offline, runs locally via ONNX Runtime' },
    { id: 'openai', provider: 'openai', model: 'text-embedding-3-small', dimensions: 1536, description: 'Best quality, requires OPENAI_API_KEY' },
    { id: 'ollama', provider: 'ollama', model: 'nomic-embed-text', dimensions: 768, description: 'Local Ollama server, requires OLLAMA_BASE_URL' },
    { id: 'hashing', provider: 'local', model: 'hashing-bow-v1', dimensions: 256, description: 'Legacy deterministic hash — fast but no semantic understanding' },
  ];
}
