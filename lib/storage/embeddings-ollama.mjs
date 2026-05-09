/**
 * lib/storage/embeddings-ollama.mjs — Ollama embedding adapter.
 *
 * Requires OLLAMA_BASE_URL (default: http://localhost:11434).
 * Uses nomic-embed-text model (768d).
 */

const MODEL_ID = 'nomic-embed-text';
const DIMENSIONS = 768;

async function ollamaEmbed(baseUrl, text) {
  const res = await fetch(`${baseUrl}/api/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL_ID, prompt: text }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Ollama embedding error ${res.status}: ${body}`);
  }

  return res.json();
}

/**
 * Embed a single text string.
 * @param {string} text
 * @param {{ env?: object }} opts
 * @returns {Promise<{ embedding: Float32Array, model: string, dimensions: number }>}
 */
export async function embed(text, { env = process.env } = {}) {
  const baseUrl = env.OLLAMA_BASE_URL || 'http://localhost:11434';

  const data = await ollamaEmbed(baseUrl, text);
  return {
    embedding: new Float32Array(data.embedding),
    model: `ollama/${MODEL_ID}`,
    dimensions: DIMENSIONS,
  };
}

/**
 * Embed a batch of texts. Ollama doesn't support native batching,
 * so we process sequentially with a small concurrency limit.
 * @param {string[]} texts
 * @param {{ env?: object }} opts
 * @returns {Promise<{ embedding: Float32Array, model: string, dimensions: number }[]>}
 */
export async function embedBatch(texts, { env = process.env } = {}) {
  const baseUrl = env.OLLAMA_BASE_URL || 'http://localhost:11434';
  const results = [];

  for (const text of texts) {
    const data = await ollamaEmbed(baseUrl, text);
    results.push({
      embedding: new Float32Array(data.embedding),
      model: `ollama/${MODEL_ID}`,
      dimensions: DIMENSIONS,
    });
  }

  return results;
}

/**
 * Return metadata about this embedding model.
 * @param {{ env?: object }} opts
 * @returns {{ id: string, model: string, provider: string, dimensions: number }}
 */
export function getModelInfo({ env = process.env } = {}) {
  return {
    id: 'ollama',
    model: `ollama/${MODEL_ID}`,
    provider: 'ollama',
    dimensions: DIMENSIONS,
  };
}
