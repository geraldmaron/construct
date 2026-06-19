/**
 * Live LLM harness for OpenRouter. Wraps fetch with a per-test cost guard
 * and skip-when-no-key behavior. Resolves OPENROUTER_API_KEY from the
 * environment first, then ~/.construct/config.env, so local dev works
 * without exporting the var manually.
 *
 * Cost guard: every call accumulates token-based USD into a per-suite
 * counter. The harness throws when the suite exceeds the configured cap so
 * a runaway test can't bill the user.
 */

import { resolveSecret, extractOpRef } from '../../../lib/providers/secret-resolver.mjs';

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';
function loadKey() {
  const direct = process.env.OPENROUTER_API_KEY;
  if (direct && !extractOpRef(direct) && !direct.startsWith('op://')) {
    return direct.trim().replace(/^["']|["']$/g, '');
  }
  try {
    return resolveSecret('OPENROUTER_API_KEY', { env: process.env }) || null;
  } catch {
    return null;
  }
}

const PRICING_USD_PER_1K_TOKENS = {
  // Cheap defaults — actual pricing depends on the model. Use a conservative
  // upper bound so the cost guard fires before real spend gets weird.

  prompt: 0.005,
  completion: 0.015,
};

export class LlmCostError extends Error {
  constructor(message, totalCents) {
    super(message);
    this.name = 'LlmCostError';
    this.totalCents = totalCents;
  }
}

// Default model: openai/gpt-4o-mini via OpenRouter. Fast (~2-5s per call),
// cheap (~$0.15 / 1M input), and routing-deterministic — `openrouter/auto`
// can pick slow upstreams that wedge live tests behind 45s timeouts.
// Tests that specifically need `auto` routing (model-tier resolution) pass
// their own model override.

export function createLlmHarness({ capUsdCents = 25, model: defaultModel = 'openai/gpt-4o-mini' } = {}) {
  const key = loadKey();
  let totalCents = 0;
  const calls = [];

  return {
    available: !!key,
    skipReason: key ? null : 'OPENROUTER_API_KEY not set (skipping live-LLM test)',
    totalCents: () => totalCents,
    callsMade: () => calls.length,
    calls,

    async complete({ model = defaultModel, system, user, maxTokens = 600, temperature = 0.3, timeoutMs = 30_000 } = {}) {
      if (!key) throw new Error('OPENROUTER_API_KEY not available');
      const messages = [];
      if (system) messages.push({ role: 'system', content: system });
      messages.push({ role: 'user', content: user });

      // AbortController gives us a typed, catchable timeout instead of
      // letting the test runner kill the whole test after 45s with no
      // diagnostic. Surfaced as a marker error so the test can skip
      // (live OpenRouter latency is observed, not enforced).

      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      let res;
      try {
        res = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${key}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://github.com/geraldmaron/construct',
            'X-Title': 'Construct test suite',
          },
          body: JSON.stringify({
            model,
            messages,
            max_tokens: maxTokens,
            temperature,
          }),
          signal: ctrl.signal,
        });
      } catch (err) {
        if (err.name === 'AbortError') {
          const e = new Error(`OpenRouter call exceeded ${timeoutMs}ms — live latency, not a code failure`);
          e.code = 'LLM_TIMEOUT';
          throw e;
        }
        throw err;
      } finally {
        clearTimeout(timer);
      }

      if (!res.ok) {
        const body = await res.text();
        throw new Error(`OpenRouter ${res.status}: ${body.substring(0, 300)}`);
      }

      const data = await res.json();
      const usage = data.usage ?? { prompt_tokens: 0, completion_tokens: 0 };
      const callCents = Math.ceil(
        ((usage.prompt_tokens / 1000) * PRICING_USD_PER_1K_TOKENS.prompt
          + (usage.completion_tokens / 1000) * PRICING_USD_PER_1K_TOKENS.completion) * 100
      );
      totalCents += callCents;
      const text = data.choices?.[0]?.message?.content ?? '';
      calls.push({ model, usage, callCents, totalCents, textLength: text.length });

      if (totalCents > capUsdCents) {
        throw new LlmCostError(
          `LLM suite cost cap exceeded: ${(totalCents / 100).toFixed(2)} USD > ${(capUsdCents / 100).toFixed(2)} USD`,
          totalCents,
        );
      }

      return { text, usage, model: data.model ?? model };
    },
  };
}
