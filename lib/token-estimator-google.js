/**
 * lib/token-estimator-google.js — Google Gemini token estimator.
 *
 * Gemini models use ~4 chars per token.
 */
export function estimate(text) {
  // Gemini: ~4 chars per token
  return Math.ceil((text || '').length / 4);
}

export async function estimateBatch(texts) {
  return (texts || []).map(t => estimate(t));
}
