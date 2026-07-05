/**
 * lib/orchestration/provider-outcome.mjs — Typed provider outcome classification,
 * bounded retry policy, and citation-grounding checks for the provider worker
 * (construct-5wkl).
 *
 * A 2xx HTTP response is transport success, not task success: the body can
 * still carry an empty answer, a content-policy refusal, or a reasoning-only
 * response with nothing in the visible channel. This module turns both
 * transport failures (rate limits, 5xx, timeouts) and content-shaped failures
 * into the same stable, machine-readable code shape so
 * lib/orchestration/worker.mjs can throw one error type that
 * lib/orchestration/runtime.mjs's existing catch path already records as
 * task.status='failed' with task.error.code — no runtime.mjs change needed.
 */

export const PROVIDER_ERROR_CODES = Object.freeze({
  RATE_LIMITED: 'PROVIDER_RATE_LIMITED',
  SERVER_ERROR: 'PROVIDER_SERVER_ERROR',
  TIMEOUT: 'PROVIDER_TIMEOUT',
  AUTH_ERROR: 'PROVIDER_AUTH_ERROR',
  CONTENT_FILTERED: 'PROVIDER_CONTENT_FILTERED',
  EMPTY_CONTENT: 'PROVIDER_EMPTY_CONTENT',
  REASONING_ONLY: 'PROVIDER_REASONING_ONLY',
  MALFORMED_RESPONSE: 'PROVIDER_MALFORMED_RESPONSE',
  EXECUTION_FAILED: 'PROVIDER_EXECUTION_FAILED',
});

// Only genuinely transient, infrastructure-level conditions are retryable —
// a content-policy refusal or a malformed body will not change on retry, and
// retrying an auth failure just spends another call to fail the same way.

const RETRYABLE_CODES = new Set([
  PROVIDER_ERROR_CODES.RATE_LIMITED,
  PROVIDER_ERROR_CODES.SERVER_ERROR,
  PROVIDER_ERROR_CODES.TIMEOUT,
]);

export function isRetryableCode(code) {
  return RETRYABLE_CODES.has(code);
}

// HTTP-status classification. OpenRouter, OpenAI, and Anthropic all use 429
// for rate limiting and 5xx for upstream/provider errors; 401/403 are
// credential problems no retry can fix. Anything else keeps the prior
// generic code so existing callers/tests are unaffected.

export function classifyHttpFailure(status) {
  if (status === 429) return { code: PROVIDER_ERROR_CODES.RATE_LIMITED, retryable: true };
  if (status >= 500 && status < 600) return { code: PROVIDER_ERROR_CODES.SERVER_ERROR, retryable: true };
  if (status === 401 || status === 403) return { code: PROVIDER_ERROR_CODES.AUTH_ERROR, retryable: false };
  return { code: PROVIDER_ERROR_CODES.EXECUTION_FAILED, retryable: false };
}

// AbortSignal.timeout firing surfaces as a DOMException/Error named
// TimeoutError or AbortError; timedFetch's own fallback throws a plain Error
// with "timed out" in the message when a stub fetchImpl ignores the signal.

export function isTimeoutError(err) {
  if (!err) return false;
  if (err.name === 'TimeoutError' || err.name === 'AbortError') return true;
  return /timed out|ETIMEDOUT/i.test(String(err.message || ''));
}

// Normalizes an OpenAI/OpenRouter-shaped chat-completions body's first choice.
// OpenRouter additionally reports native_finish_reason (the upstream model's
// own value before OpenRouter's own normalization).

export function extractChoiceMeta(data) {
  const choice = data?.choices?.[0];
  return {
    message: choice?.message && typeof choice.message === 'object' ? choice.message : null,
    finishReason: choice?.finish_reason ?? null,
    nativeFinishReason: choice?.native_finish_reason ?? null,
  };
}

export function extractUsage(data) {
  const usage = data?.usage;
  if (!usage || typeof usage !== 'object') return null;
  const promptTokens = Number(usage.prompt_tokens ?? usage.input_tokens);
  const completionTokens = Number(usage.completion_tokens ?? usage.output_tokens);
  const totalTokens = Number(usage.total_tokens ?? (promptTokens + completionTokens));
  if (!Number.isFinite(promptTokens) && !Number.isFinite(completionTokens) && !Number.isFinite(totalTokens)) return null;
  return {
    promptTokens: Number.isFinite(promptTokens) ? promptTokens : undefined,
    completionTokens: Number.isFinite(completionTokens) ? completionTokens : undefined,
    totalTokens: Number.isFinite(totalTokens) ? totalTokens : undefined,
  };
}

// After a 2xx response, transport succeeded but the answer may still be
// unusable. A content-policy refusal and a reasoning-only response (visible
// answer empty, model reasoning non-empty, finish_reason length — the model
// spent its entire output budget on reasoning tokens and never reached the
// answer) are both distinguishable from a genuinely empty response.

export function classifyContentOutcome({ content, finishReason, reasoning, wantsReasoning }) {
  const text = typeof content === 'string' ? content.trim() : '';
  const hasReasoning = typeof reasoning === 'string' && reasoning.trim().length > 0;

  if (finishReason === 'content_filter') {
    return { ok: false, code: PROVIDER_ERROR_CODES.CONTENT_FILTERED, retryable: false };
  }
  if (!text && wantsReasoning && hasReasoning) {
    return { ok: false, code: PROVIDER_ERROR_CODES.REASONING_ONLY, retryable: false };
  }
  if (!text) {
    return { ok: false, code: PROVIDER_ERROR_CODES.EMPTY_CONTENT, retryable: false };
  }
  return { ok: true };
}

// Malformed-choices guard: a 2xx body missing choices[0].message entirely is
// not the same failure as an empty string answer — it means the provider's
// response shape itself did not match what the caller expects.

export function isMalformedChoice(data) {
  const choice = data?.choices?.[0];
  return !choice || typeof choice !== 'object' || !choice.message || typeof choice.message !== 'object';
}

// Exponential backoff with a fixed small ceiling — provider calls already run
// seconds-to-minutes (PROVIDER_TIMEOUT_DEFAULT_MS), so the retry delay only
// needs to clear a rate-limit window's typical reset granularity, not model
// latency. attempt is 1-indexed (the delay before the 2nd, 3rd, ... call).

export function computeBackoffMs(attempt, baseMs = 250) {
  return baseMs * 2 ** Math.max(0, attempt - 1);
}

async function defaultSleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Retry wrapper: calls `attemptFn(attemptNumber)` up to `maxAttempts` times
 * (1-indexed). `attemptFn` must throw an error carrying `.code` and
 * `.retryable` (as produced by classifyHttpFailure/isTimeoutError callers) on
 * failure. Retries only when `.retryable` is true and attempts remain;
 * preserves the final error's full chain by attaching `.attempts` and
 * `.retryCount` rather than replacing it, so the caller sees exactly what the
 * last real attempt failed with (construct-5wkl AC#4).
 */
export async function withProviderRetry(attemptFn, { maxAttempts = 3, baseDelayMs = 250, sleep = defaultSleep } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const result = await attemptFn(attempt);
      if (result && typeof result === 'object') result.retryCount = attempt - 1;
      return result;
    } catch (err) {
      lastErr = err;
      const canRetry = err?.retryable === true && attempt < maxAttempts;
      if (!canRetry) {
        if (err && typeof err === 'object') err.retryCount = attempt - 1;
        throw err;
      }
      await sleep(computeBackoffMs(attempt, baseDelayMs));
    }
  }
  throw lastErr;
}

// ── Evidence grounding (construct-5wkl AC#5) ─────────────────────────────────
// A web-capable specialist's governed evidence (task.webEvidence, ADR-0050) is
// the only citation source Construct has actually observed. Any URL the model
// writes into its answer that does not appear in that governed evidence is
// either fabricated outright or drawn from ungoverned model memory — either
// way it is not verified evidence and must not be presented as such.

const URL_PATTERN = /https?:\/\/[^\s)\]}"'<>]+/gi;

function normalizeUrl(url) {
  return String(url || '').trim().replace(/[.,;:!?)\]}'"]+$/, '').replace(/\/$/, '').toLowerCase();
}

export function extractCitedUrls(text) {
  if (typeof text !== 'string' || !text) return [];
  const matches = text.match(URL_PATTERN) || [];
  return [...new Set(matches.map(normalizeUrl))];
}

/**
 * Returns the subset of URLs cited in `text` that do not appear among
 * `evidenceUrls` (the governed web-evidence list). An empty return means every
 * citation in the text traces to observed evidence.
 */
export function findUnverifiedCitations(text, evidenceUrls = []) {
  const cited = extractCitedUrls(text);
  if (!cited.length) return [];
  const known = new Set((evidenceUrls || []).map(normalizeUrl));
  return cited.filter((url) => !known.has(url));
}
