/**
 * lib/token-estimator-openai.js — OpenAI GPT token estimator.
 *
 * GPT models use ~4 chars per token.
 */
export function estimate(text) {
  // GPT: ~4 chars per token
  return Math.ceil((text || '').length / 4);
}

export async function estimateBatch(texts) {
  return (texts || []).map(t => estimate(t));
}
