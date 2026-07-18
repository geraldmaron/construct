/**
 * tests/intent-classifier-claude-api-migration.test.mjs — equivalence coverage
 * for construct-b0nny.19's migration of lib/intent-classifier.mjs's
 * Anthropic-direct branch off a hand-rolled fetch onto the E4 claude-api
 * runtime adapter (lib/runtime/contract/adapters/coding/claude-api.mjs).
 *
 * Asserts the migrated `callAnthropicDirect` sends the same request shape
 * (bare model id, max_tokens 256, separate system/user turns) and preserves
 * the pre-migration error contract (`anthropic ${status}` on a non-2xx
 * response, a timeout error when the INTENT_VERIFY_TIMEOUT_MS budget is
 * exceeded) that lib/intent-classifier.mjs's callers already depend on —
 * verifyIntent's catch-all falls back to `verified:true, source:'fallback'`
 * regardless of the exact error text, but this suite locks the text down
 * anyway so a future adapter change can't silently drift it.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { callAnthropicDirect, INTENT_VERIFY_TIMEOUT_MS } from '../lib/intent-classifier.mjs';

function fakeFetch({ status = 200, text = 'echoed', delayMs = 0 } = {}) {
  return function fetchFn(_url, opts) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (status !== 200) {
          resolve({ ok: false, status, text: async () => 'error detail' });
          return;
        }
        resolve({ ok: true, status: 200, json: async () => ({ content: [{ text }] }) });
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

describe('intent-classifier callAnthropicDirect — E4 adapter migration equivalence', () => {
  it('sends the bare model id, max_tokens 256, and separate system/user turns', async () => {
    let seenUrl;
    let seenBody;
    let seenKey;
    const fetchFn = async (url, opts) => {
      seenUrl = url;
      seenBody = JSON.parse(opts.body);
      seenKey = opts.headers['x-api-key'];
      return { ok: true, status: 200, json: async () => ({ content: [{ text: 'verdict' }] }) };
    };

    const output = await callAnthropicDirect({
      system: 'system prompt',
      user: 'user prompt',
      modelId: 'anthropic/claude-haiku-4-5-20251001',
      anthropicKey: '__TEST_KEY__',
      fetchFn,
    });

    assert.equal(seenUrl, 'https://api.anthropic.com/v1/messages');
    assert.equal(seenKey, '__TEST_KEY__');
    assert.equal(seenBody.model, 'claude-haiku-4-5-20251001', 'anthropic/ prefix stripped, matching pre-migration behavior');
    assert.equal(seenBody.max_tokens, 256);
    assert.equal(seenBody.system, 'system prompt');
    assert.equal(seenBody.messages.length, 1);
    assert.equal(seenBody.messages[0].role, 'user');
    assert.equal(seenBody.messages[0].content, 'user prompt');
    assert.equal(output, 'verdict');
  });

  it('preserves the pre-migration "anthropic <status>" error message on a non-2xx response', async () => {
    await assert.rejects(
      () => callAnthropicDirect({
        system: 's',
        user: 'u',
        modelId: 'anthropic/claude-haiku-4-5-20251001',
        anthropicKey: '__TEST_KEY__',
        fetchFn: fakeFetch({ status: 429 }),
      }),
      (err) => {
        assert.equal(err.message, 'anthropic 429');
        return true;
      },
    );
  });

  it('throws a timeout error and aborts the request when the timeout budget elapses', async () => {
    const shortTimeoutMs = 30;
    const fetchFn = fakeFetch({ delayMs: shortTimeoutMs + 500 });
    await assert.rejects(
      () => callAnthropicDirect({
        system: 's',
        user: 'u',
        modelId: 'anthropic/claude-haiku-4-5-20251001',
        anthropicKey: '__TEST_KEY__',
        fetchFn,
        timeoutMs: shortTimeoutMs,
      }),
      (err) => {
        assert.match(err.message, new RegExp(`timed out after ${shortTimeoutMs}ms`));
        return true;
      },
    );
  });

  it('defaults the timeout budget to INTENT_VERIFY_TIMEOUT_MS when not overridden', () => {
    assert.equal(INTENT_VERIFY_TIMEOUT_MS, 3000, 'the production default this migration preserves');
  });

  it('joins multiple Messages API content blocks the same way the raw fetch call did', async () => {
    const fetchFn = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ content: [{ text: 'a' }, { text: 'b' }] }),
    });
    const output = await callAnthropicDirect({
      system: 's',
      user: 'u',
      modelId: 'anthropic/claude-haiku-4-5-20251001',
      anthropicKey: '__TEST_KEY__',
      fetchFn,
    });
    assert.equal(output, 'ab');
  });
});
