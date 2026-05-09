/**
 * lib/storage/embeddings-openai.mjs — OpenAI embedding adapter.
 *
 * Requires OPENAI_API_KEY. Uses text-embedding-3-small (1536d).
 * Supports native batching for up to 2048 inputs per request.
 */

const MODEL_ID = 'text-embedding-3-small';
const DIMENSIONS = 1536;
const MAX_BATCH_SIZE = 2048;

async function openaiEmbed(key, input) {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: MODEL_ID, input }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`OpenAI embedding error ${res.status}: ${body}`);
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
  const key = env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY required for OpenAI embeddings');

  const data = await openaiEmbed(key, text);
  return {
    embedding: new Float32Array(data.data[0].embedding),
    model: `openai/${MODEL_ID}`,
    dimensions: DIMENSIONS,
  };
}

/**
 * Embed a batch of texts using OpenAI's native batching.
 * @param {string[]} texts
 * @param {{ env?: object }} opts
 * @returns {Promise<{ embedding: Float32Array, model: string, dimensions: number }[]>}
 */
export async function embedBatch(texts, { env = process.env } = {}) {
  const key = env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY required for OpenAI embeddings');

  const results = [];
  for (let i = 0; i < texts.length; i += MAX_BATCH_SIZE) {
    const batch = texts.slice(i, i + MAX_BATCH_SIZE);
    const data = await openaiEmbed(key, batch);
    for (const item of data.data) {
      results.push({
        embedding: new Float32Array(item.embedding),
        model: `openai/${MODEL_ID}`,
        dimensions: DIMENSIONS,
      });
    }
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
    id: 'openai',
    model: `openai/${MODEL_ID}`,
    provider: 'openai',
    dimensions: DIMENSIONS,
  };
}
