/**
 * lib/token-estimator-deepseek.js — DeepSeek token estimator.
 *
 * DeepSeek models use ~3 chars per token (similar to Claude).
 */
export function estimate(text) {
  // DeepSeek: ~3 chars per token
  return Math.ceil((text || '').length / 3);
}

export async function estimateBatch(texts) {
  return (texts || []).map(t => estimate(t));
}
