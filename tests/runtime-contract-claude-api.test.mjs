/**
 * tests/runtime-contract-claude-api.test.mjs — conformance + unit tests for
 * the claude-api coding-runtime adapter. Uses a fake fetchFn (no real
 * network call against api.anthropic.com).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runConformanceSuite } from '../lib/runtime/contract/conformance.mjs';
import { createClaudeApiRuntime } from '../lib/runtime/contract/adapters/coding/claude-api.mjs';

/**
 * A fake fetch that mimics the Anthropic Messages API response shape,
 * delaying its resolution when the request prompt is the slow marker so the
 * conformance suite's cancel/in-flight cases can exercise abort behavior.
 */
function fakeFetch({ status = 200, delayMs = 0 } = {}) {
  return function fetchFn(_url, opts) {
    const body = JSON.parse(opts.body);
    const prompt = body.messages[0].content;
    const wait = prompt === 'CONFORMANCE_SLOW' ? Math.max(delayMs, 200) : 0;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (status !== 200) {
          resolve({ ok: false, status, text: async () => 'error detail' });
          return;
        }
        resolve({
          ok: true,
          status: 200,
          json: async () => ({ content: [{ type: 'text', text: `echoed:${prompt}` }] }),
        });
      }, wait);

      opts.signal?.addEventListener('abort', () => {
        clearTimeout(timer);
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        reject(err);
      });
    });
  };
}

runConformanceSuite({
  name: 'claude-api (coding)',
  createRuntime: () =>
    createClaudeApiRuntime({ name: 'claude-api-test', apiKey: '__TEST_API_KEY__', fetchFn: fakeFetch() }),
  initConfig: {},
  invokeEcho: (runtime) => runtime.invoke({ input: { prompt: 'hello' } }, {}),
  invokeSlow: (runtime, invocationId) =>
    runtime.invoke({ input: { prompt: 'CONFORMANCE_SLOW' } }, { invocationId }),
  supportsInterrupt: true,
});

describe('claude-api runtime — unit behavior', () => {
  it('joins Messages API content blocks into the output string', async () => {
    const fetchFn = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ content: [{ text: 'a' }, { text: 'b' }] }),
    });
    const runtime = createClaudeApiRuntime({ name: 'joiner', apiKey: '__TEST_API_KEY__', fetchFn });
    await runtime.init();
    const result = await runtime.invoke({ input: { prompt: 'x' } }, {});
    assert.equal(result.output, 'ab');
  });

  it('maps a non-2xx response to status "failed" with the HTTP code', async () => {
    const runtime = createClaudeApiRuntime({
      name: 'unauthorized',
      apiKey: '__TEST_API_KEY__',
      fetchFn: fakeFetch({ status: 401 }),
    });
    await runtime.init();
    const result = await runtime.invoke({ input: { prompt: 'x' } }, {});
    assert.equal(result.status, 'failed');
    assert.equal(result.error.code, 'HTTP_401');
  });

  it('resolves the API key from init(config) over the constructor default', async () => {
    let seenKey;
    const fetchFn = async (_url, opts) => {
      seenKey = opts.headers['x-api-key'];
      return { ok: true, status: 200, json: async () => ({ content: [] }) };
    };
    const runtime = createClaudeApiRuntime({ name: 'key-check', apiKey: '__TEST_API_KEY_CTOR__', fetchFn });
    await runtime.init({ apiKey: '__TEST_API_KEY_OVERRIDE__' });
    await runtime.invoke({ input: { prompt: 'x' } }, {});
    assert.equal(seenKey, '__TEST_API_KEY_OVERRIDE__');
  });

  it('sends request.input.system as the Messages API top-level system parameter', async () => {
    let seenBody;
    const fetchFn = async (_url, opts) => {
      seenBody = JSON.parse(opts.body);
      return { ok: true, status: 200, json: async () => ({ content: [{ text: 'ok' }] }) };
    };
    const runtime = createClaudeApiRuntime({ name: 'system-check', apiKey: '__TEST_API_KEY__', fetchFn });
    await runtime.init();
    await runtime.invoke({ input: { prompt: 'user turn', system: 'system turn' } }, {});
    assert.equal(seenBody.system, 'system turn');
    assert.equal(seenBody.messages.length, 1);
    assert.equal(seenBody.messages[0].content, 'user turn');
  });

  it('omits the system field entirely when request.input.system is not supplied', async () => {
    let seenBody;
    const fetchFn = async (_url, opts) => {
      seenBody = JSON.parse(opts.body);
      return { ok: true, status: 200, json: async () => ({ content: [] }) };
    };
    const runtime = createClaudeApiRuntime({ name: 'no-system', apiKey: '__TEST_API_KEY__', fetchFn });
    await runtime.init();
    await runtime.invoke({ input: { prompt: 'user turn' } }, {});
    assert.equal('system' in seenBody, false);
  });

  it('surfaces input/output token usage on a completed result when the response includes it', async () => {
    const fetchFn = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ content: [{ text: 'ok' }], usage: { input_tokens: 12, output_tokens: 34 } }),
    });
    const runtime = createClaudeApiRuntime({ name: 'usage-check', apiKey: '__TEST_API_KEY__', fetchFn });
    await runtime.init();
    const result = await runtime.invoke({ input: { prompt: 'x' } }, {});
    assert.deepEqual(result.usage, { inputTokens: 12, outputTokens: 34 });
  });

  it('omits usage entirely when the response carries none', async () => {
    const fetchFn = async () => ({ ok: true, status: 200, json: async () => ({ content: [{ text: 'ok' }] }) });
    const runtime = createClaudeApiRuntime({ name: 'no-usage', apiKey: '__TEST_API_KEY__', fetchFn });
    await runtime.init();
    const result = await runtime.invoke({ input: { prompt: 'x' } }, {});
    assert.equal('usage' in result, false);
  });
});
