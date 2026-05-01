/**
 * lib/token-estimator-default.js — Conservative default token estimator.
 *
 * Uses ~4 chars per token (safe for most models).
 */
export function estimate(text) {
  // Conservative default: 4 chars per token
  return Math.ceil((text || '').length / 4);
}

export async function estimateBatch(texts) {
  return (texts || []).map(t => estimate(t));
}
