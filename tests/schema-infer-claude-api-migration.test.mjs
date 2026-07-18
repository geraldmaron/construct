/**
 * tests/schema-infer-claude-api-migration.test.mjs — equivalence coverage for
 * construct-b0nny.19's migration of lib/schema-infer.mjs's Anthropic-direct
 * transport off a hand-rolled fetch onto the E4 claude-api runtime adapter
 * (lib/runtime/contract/adapters/coding/claude-api.mjs).
 *
 * schema-infer.mjs's own retry/telemetry/rate-limit orchestration
 * (callModel's candidate loop) is unchanged — only the "send one request,
 * get one result" transport moved, via the exported invokeAnthropicViaRuntime
 * helper. This suite locks in the discriminated outcomes that helper must
 * keep returning so callModel's existing control flow (429 → continue with a
 * WARNING trace, timeout → continue with an ERROR trace, other HTTP failure
 * → throw and stop the candidate loop, success → return text + usage for
 * cost telemetry) stays intact.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { invokeAnthropicViaRuntime } from '../lib/schema-infer.mjs';

function fakeFetch({ status = 200, text = 'echoed', usage, delayMs = 0 } = {}) {
  return function fetchFn(_url, opts) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (status !== 200) {
          resolve({ ok: false, status, text: async () => 'error detail' });
          return;
        }
        resolve({ ok: true, status: 200, json: async () => ({ content: [{ text }], ...(usage ? { usage } : {}) }) });
      }, delayMs);
      opts.signal?.addEventListener('abort', () => {
        clearTimeout(timer);
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        reject(err);
      });
    });
  };
}

describe('schema-infer invokeAnthropicViaRuntime — E4 adapter migration equivalence', () => {
  it('returns { text, usage } on success, mapping input/output/total tokens the same way the raw fetch call did', async () => {
    const outcome = await invokeAnthropicViaRuntime({
      apiKey: '__TEST_KEY__',
      model: 'claude-haiku-4-5-20251001',
      system: 'system prompt',
      prompt: 'user content',
      maxTokens: 4096,
      fetchFn: fakeFetch({ text: 'inferred schema', usage: { input_tokens: 100, output_tokens: 50 } }),
    });
    assert.equal(outcome.text, 'inferred schema');
    assert.deepEqual(outcome.usage, { input: 100, output: 50, total: 150 });
    assert.equal(outcome.rateLimited, undefined);
    assert.equal(outcome.timedOut, undefined);
    assert.equal(outcome.error, undefined);
  });

  it('sends the bare model id, max_tokens, and a separate system turn — same request shape as the original fetch body', async () => {
    let seenBody;
    const fetchFn = async (_url, opts) => {
      seenBody = JSON.parse(opts.body);
      return { ok: true, status: 200, json: async () => ({ content: [{ text: 'x' }] }) };
    };
    await invokeAnthropicViaRuntime({
      apiKey: '__TEST_KEY__',
      model: 'claude-haiku-4-5-20251001',
      system: 'SYSTEM_PROMPT text',
      prompt: 'document text',
      maxTokens: 4096,
      fetchFn,
    });
    assert.equal(seenBody.model, 'claude-haiku-4-5-20251001');
    assert.equal(seenBody.max_tokens, 4096);
    assert.equal(seenBody.system, 'SYSTEM_PROMPT text');
    assert.equal(seenBody.messages[0].content, 'document text');
  });

  it('discriminates a 429 as rateLimited:true rather than throwing, matching the original res.status===429 branch', async () => {
    const outcome = await invokeAnthropicViaRuntime({
      apiKey: '__TEST_KEY__',
      model: 'claude-haiku-4-5-20251001',
      system: 's',
      prompt: 'u',
      maxTokens: 4096,
      fetchFn: fakeFetch({ status: 429 }),
    });
    assert.equal(outcome.rateLimited, true);
    assert.equal(outcome.text, undefined);
    assert.equal(outcome.error, undefined);
  });

  it('returns an error (not a throw) for a non-429 HTTP failure, preserving the "Anthropic API <status>: <detail>" message', async () => {
    const outcome = await invokeAnthropicViaRuntime({
      apiKey: '__TEST_KEY__',
      model: 'claude-haiku-4-5-20251001',
      system: 's',
      prompt: 'u',
      maxTokens: 4096,
      fetchFn: fakeFetch({ status: 401 }),
    });
    assert.equal(outcome.rateLimited, undefined);
    assert.ok(outcome.error instanceof Error);
    assert.match(outcome.error.message, /^Anthropic API 401: error detail$/);
  });

  it('discriminates a timeout as timedOut:true rather than throwing an AbortError, matching the original fetchWithTimeout behavior', async () => {
    const shortTimeoutMs = 30;
    const outcome = await invokeAnthropicViaRuntime({
      apiKey: '__TEST_KEY__',
      model: 'claude-haiku-4-5-20251001',
      system: 's',
      prompt: 'u',
      maxTokens: 4096,
      fetchFn: fakeFetch({ delayMs: shortTimeoutMs + 500 }),
      timeoutMs: shortTimeoutMs,
    });
    assert.equal(outcome.timedOut, true);
    assert.equal(outcome.rateLimited, undefined);
    assert.equal(outcome.error, undefined);
  });

  it('omits usage when the response carries none, matching the original data.usage-guarded ternary', async () => {
    const outcome = await invokeAnthropicViaRuntime({
      apiKey: '__TEST_KEY__',
      model: 'claude-haiku-4-5-20251001',
      system: 's',
      prompt: 'u',
      maxTokens: 4096,
      fetchFn: fakeFetch({ text: 'no usage here' }),
    });
    assert.equal(outcome.usage, undefined);
    assert.equal(outcome.text, 'no usage here');
  });
});
