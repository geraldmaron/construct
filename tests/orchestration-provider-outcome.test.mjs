/**
 * tests/orchestration-provider-outcome.test.mjs — provider outcome classification,
 * bounded retry, and citation-grounding helpers (construct-5wkl).
 *
 * Pins that HTTP failures classify into stable, distinguishable codes with the
 * right retryable flag, that a 2xx response with unusable content (empty,
 * content-filtered, reasoning-only, malformed) also classifies rather than
 * being accepted as valid output, that the retry wrapper only retries
 * retryable outcomes up to its bound and preserves the final error, and that
 * citation grounding flags a URL absent from governed web evidence.
 *
 * @enforces construct-5wkl AC#1, AC#4, AC#5, AC#6
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PROVIDER_ERROR_CODES,
  classifyHttpFailure,
  classifyContentOutcome,
  computeBackoffMs,
  extractChoiceMeta,
  extractCitedUrls,
  extractUsage,
  findUnverifiedCitations,
  isMalformedChoice,
  isRetryableCode,
  isTimeoutError,
  withProviderRetry,
} from '../lib/orchestration/provider-outcome.mjs';

test('classifyHttpFailure distinguishes rate limit, server error, auth, and generic failures', () => {
  assert.deepEqual(classifyHttpFailure(429), { code: PROVIDER_ERROR_CODES.RATE_LIMITED, retryable: true });
  assert.deepEqual(classifyHttpFailure(500), { code: PROVIDER_ERROR_CODES.SERVER_ERROR, retryable: true });
  assert.deepEqual(classifyHttpFailure(503), { code: PROVIDER_ERROR_CODES.SERVER_ERROR, retryable: true });
  assert.deepEqual(classifyHttpFailure(401), { code: PROVIDER_ERROR_CODES.AUTH_ERROR, retryable: false });
  assert.deepEqual(classifyHttpFailure(403), { code: PROVIDER_ERROR_CODES.AUTH_ERROR, retryable: false });
  assert.deepEqual(classifyHttpFailure(402), { code: PROVIDER_ERROR_CODES.NO_CREDITS, retryable: false });
  assert.deepEqual(classifyHttpFailure(404), { code: PROVIDER_ERROR_CODES.EXECUTION_FAILED, retryable: false });
});

test('isRetryableCode matches only the transport-classified transient codes', () => {
  assert.equal(isRetryableCode(PROVIDER_ERROR_CODES.RATE_LIMITED), true);
  assert.equal(isRetryableCode(PROVIDER_ERROR_CODES.SERVER_ERROR), true);
  assert.equal(isRetryableCode(PROVIDER_ERROR_CODES.TIMEOUT), true);
  assert.equal(isRetryableCode(PROVIDER_ERROR_CODES.CONTENT_FILTERED), false);
  assert.equal(isRetryableCode(PROVIDER_ERROR_CODES.AUTH_ERROR), false);
  assert.equal(isRetryableCode(PROVIDER_ERROR_CODES.MALFORMED_RESPONSE), false);
});

test('isTimeoutError recognizes AbortSignal.timeout-style errors and the timedFetch fallback message', () => {
  assert.equal(isTimeoutError(Object.assign(new Error('aborted'), { name: 'TimeoutError' })), true);
  assert.equal(isTimeoutError(Object.assign(new Error('aborted'), { name: 'AbortError' })), true);
  assert.equal(isTimeoutError(new Error('provider timed out after 500ms')), true);
  assert.equal(isTimeoutError(new Error('ETIMEDOUT')), true);
  assert.equal(isTimeoutError(new Error('connection reset')), false);
  assert.equal(isTimeoutError(null), false);
});

test('classifyContentOutcome flags content_filter, reasoning-only, and empty content distinctly', () => {
  assert.deepEqual(
    classifyContentOutcome({ content: '', finishReason: 'content_filter', reasoning: '', wantsReasoning: false }),
    { ok: false, code: PROVIDER_ERROR_CODES.CONTENT_FILTERED, retryable: false },
  );
  assert.deepEqual(
    classifyContentOutcome({ content: '', finishReason: 'length', reasoning: 'a long chain of thought', wantsReasoning: true }),
    { ok: false, code: PROVIDER_ERROR_CODES.REASONING_ONLY, retryable: false },
  );
  assert.deepEqual(
    classifyContentOutcome({ content: '', finishReason: 'stop', reasoning: '', wantsReasoning: false }),
    { ok: false, code: PROVIDER_ERROR_CODES.EMPTY_CONTENT, retryable: false },
  );
  assert.deepEqual(
    classifyContentOutcome({ content: 'a real answer', finishReason: 'stop', reasoning: '', wantsReasoning: false }),
    { ok: true },
  );
});

test('isMalformedChoice detects a response with no usable choices[0].message', () => {
  assert.equal(isMalformedChoice({}), true);
  assert.equal(isMalformedChoice({ choices: [] }), true);
  assert.equal(isMalformedChoice({ choices: [{}] }), true);
  assert.equal(isMalformedChoice({ choices: [{ message: { content: 'ok' } }] }), false);
});

test('extractChoiceMeta and extractUsage normalize OpenAI/OpenRouter-shaped bodies', () => {
  const data = {
    choices: [{ message: { content: 'hi' }, finish_reason: 'length', native_finish_reason: 'MAX_TOKENS' }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  };
  const meta = extractChoiceMeta(data);
  assert.equal(meta.message.content, 'hi');
  assert.equal(meta.finishReason, 'length');
  assert.equal(meta.nativeFinishReason, 'MAX_TOKENS');
  assert.deepEqual(extractUsage(data), { promptTokens: 10, completionTokens: 5, totalTokens: 15 });
  assert.equal(extractUsage({}), null);
});

test('computeBackoffMs doubles per attempt from the base delay', () => {
  assert.equal(computeBackoffMs(1, 250), 250);
  assert.equal(computeBackoffMs(2, 250), 500);
  assert.equal(computeBackoffMs(3, 250), 1000);
});

test('withProviderRetry retries a retryable failure until it succeeds, and records retryCount', async () => {
  let calls = 0;
  const sleeps = [];
  const result = await withProviderRetry(async () => {
    calls += 1;
    if (calls < 3) {
      const err = new Error('server error');
      err.retryable = true;
      throw err;
    }
    return { output: 'ok' };
  }, { maxAttempts: 5, baseDelayMs: 10, sleep: async (ms) => { sleeps.push(ms); } });

  assert.equal(calls, 3);
  assert.equal(result.output, 'ok');
  assert.equal(result.retryCount, 2);
  assert.deepEqual(sleeps, [10, 20]);
});

test('withProviderRetry stops immediately on a non-retryable failure and preserves the error', async () => {
  let calls = 0;
  await assert.rejects(
    () => withProviderRetry(async () => {
      calls += 1;
      const err = new Error('content filtered');
      err.code = PROVIDER_ERROR_CODES.CONTENT_FILTERED;
      err.retryable = false;
      throw err;
    }, { maxAttempts: 5, baseDelayMs: 1, sleep: async () => {} }),
    (err) => err.code === PROVIDER_ERROR_CODES.CONTENT_FILTERED && err.retryCount === 0,
  );
  assert.equal(calls, 1);
});

test('withProviderRetry exhausts maxAttempts and throws the final error with the full retryCount', async () => {
  let calls = 0;
  await assert.rejects(
    () => withProviderRetry(async () => {
      calls += 1;
      const err = new Error('still failing');
      err.code = PROVIDER_ERROR_CODES.SERVER_ERROR;
      err.retryable = true;
      throw err;
    }, { maxAttempts: 3, baseDelayMs: 1, sleep: async () => {} }),
    (err) => err.code === PROVIDER_ERROR_CODES.SERVER_ERROR && err.retryCount === 2,
  );
  assert.equal(calls, 3);
});

test('extractCitedUrls and findUnverifiedCitations catch a citation absent from governed evidence', () => {
  const text = 'See https://real-evidence.example/a and also https://fabricated.example/nope for details.';
  assert.deepEqual(extractCitedUrls(text), ['https://real-evidence.example/a', 'https://fabricated.example/nope']);

  const unverified = findUnverifiedCitations(text, ['https://real-evidence.example/a']);
  assert.deepEqual(unverified, ['https://fabricated.example/nope']);
});

test('findUnverifiedCitations returns empty when every citation traces to governed evidence', () => {
  const text = 'Per https://real-evidence.example/a, the claim holds.';
  assert.deepEqual(findUnverifiedCitations(text, ['https://real-evidence.example/a/']), []);
});

test('findUnverifiedCitations returns empty for text with no citations at all', () => {
  assert.deepEqual(findUnverifiedCitations('No links here.', ['https://real-evidence.example/a']), []);
});
