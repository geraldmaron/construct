/**
 * lib/engine/tokens.mjs — Accurate token counting with a graceful fallback.
 *
 * Wraps the `tiktoken` package when it's installed and reachable; otherwise
 * falls back to the conventional `chars/4` approximation that the codebase
 * has used historically. Operators that care about precise budgets should
 * `npm install tiktoken` and the wrapper will pick it up automatically.
 *
 * The module is intentionally async-first: tiktoken's encoder loads its
 * BPE table lazily, so the surface stays uniform whether tiktoken is present
 * or not. Synchronous estimation is available via `estimateChars`.
 *
 * The module is the C6 pin-point for the rebuild plan: callers that enforce
 * a token budget should call `countTokens(text)` and fail closed if the
 * resulting count exceeds the budget. Without tiktoken, the count is an
 * estimate; we don't lie about that — the returned object includes a
 * `mode: 'tiktoken' | 'estimate'` field so callers can decide whether the
 * approximation is acceptable for their use case.
 */

let encoderPromise = null;
let encoderUnavailable = false;

const APPROX_CHARS_PER_TOKEN = 4;

/**
 * Synchronous estimator. Always succeeds, never as accurate as tiktoken.
 *
 * @param {string} text
 * @returns {number} estimated token count
 */
export function estimateChars(text) {
  return Math.ceil(String(text || '').length / APPROX_CHARS_PER_TOKEN);
}

async function getEncoder() {
  if (encoderUnavailable) return null;
  if (encoderPromise) return encoderPromise;
  encoderPromise = (async () => {
    try {
      const mod = await import('tiktoken');
      const enc = (mod.encoding_for_model || mod.default?.encoding_for_model)?.('gpt-4o-mini')
        ?? (mod.get_encoding || mod.default?.get_encoding)?.('cl100k_base');
      if (!enc) throw new Error('tiktoken module did not expose a recognised factory');
      return enc;
    } catch {
      encoderUnavailable = true;
      return null;
    }
  })();
  return encoderPromise;
}

/**
 * Async accurate counter. Returns `{ tokens, mode }`.
 *
 * @param {string} text
 * @returns {Promise<{ tokens: number, mode: 'tiktoken' | 'estimate' }>}
 */
export async function countTokens(text) {
  const enc = await getEncoder();
  if (!enc) return { tokens: estimateChars(text), mode: 'estimate' };
  try {
    const ids = enc.encode(String(text || ''));
    return { tokens: ids.length, mode: 'tiktoken' };
  } catch {
    return { tokens: estimateChars(text), mode: 'estimate' };
  }
}

/**
 * Drop the cached encoder — test hook for re-running after toggling availability.
 */
export function _resetEncoderForTests() {
  encoderPromise = null;
  encoderUnavailable = false;
}
