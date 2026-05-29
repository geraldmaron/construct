/**
 * Live LLM test for the three-tier model router (reasoning / standard /
 * fast). For each tier, run one completion against OpenRouter using a model
 * that exercises that tier's intent (deep reasoning vs cheap throughput),
 * assert success + that the response reflects the requested tier shape.
 *
 * Skipped when OPENROUTER_API_KEY is absent.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createLlmHarness } from '../_lib/openrouter-llm.mjs';

// All tiers route through `openrouter/auto` so OpenRouter picks an
// available endpoint regardless of which specific model slugs the account
// has access to. The tier semantics (max tokens, temperature, prompt shape)
// still differ — those are what the tier abstraction actually carries.

const TIER_MODELS = {
  reasoning: 'openrouter/auto',
  standard: 'openrouter/auto',
  fast: 'openrouter/auto',
};

const TIER_PROMPTS = {
  reasoning: 'Walk through the steps of solving x^2 - 5x + 6 = 0 in plain language. End with the two roots.',
  standard: 'Write one sentence that explains what a feature flag is.',
  fast: 'Reply with exactly the word "ok".',
};

const TIER_EXPECT = {
  reasoning: (text) => /(2|3|root|equation|quadratic)/i.test(text),
  standard: (text) => text.length > 20 && /flag/i.test(text),
  fast: (text) => text.trim().length < 50,
};

for (const [tier, model] of Object.entries(TIER_MODELS)) {
  test(`${tier}-tier resolves and responds via OpenRouter (model: ${model})`, { timeout: 45_000 }, async (t) => {
    const llm = createLlmHarness({ capUsdCents: 25 });
    if (!llm.available) { t.skip(llm.skipReason); return; }

    let result;
    try {
      result = await llm.complete({
        model,
        user: TIER_PROMPTS[tier],
        maxTokens: tier === 'fast' ? 20 : 400,
        temperature: tier === 'fast' ? 0 : 0.3,
      });
    } catch (e) {
      // OpenRouter may refuse a specific model for the test account; that's
      // a routing-availability issue not a Construct issue. Skip rather
      // than fail in that case.

      if (/404|403|model.*not/i.test(e.message)) {
        t.skip(`OpenRouter declined model ${model}: ${e.message.substring(0, 200)}`);
        return;
      }
      if (e.code === 'LLM_TIMEOUT') {
        t.skip(`OpenRouter timeout for ${model}: ${e.message}`);
        return;
      }
      throw e;
    }

    assert.ok(result.text.length > 0, `${tier}: response must be non-empty`);
    const checker = TIER_EXPECT[tier];
    assert.ok(checker(result.text), `${tier}: response shape mismatch. Got: ${result.text.substring(0, 200)}`);
    console.log(`[tier:${tier}] model=${result.model} chars=${result.text.length} cost=${llm.totalCents()}¢`);
  });
}
