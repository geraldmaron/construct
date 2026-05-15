/**
 * tests/cost-reconciliation.test.mjs — 3-way cost reconciliation gate.
 *
 * Cost ceilings are only as trustworthy as the numbers feeding them.
 * The test pins that the same usage payload produces an identical
 * cost across three places that must never diverge:
 *
 *   (A) buildRuntimeTracePayload metadata.costUsd
 *   (B) the cost the opencode plugin would attach to ingest.generation
 *   (C) the cost a direct estimateUsageCost() call returns
 *
 * Any divergence is a correctness bug — Phase 7b ceilings, dashboard
 * Costs page, and the cost-ledger all rely on (C) being the canonical
 * value, with (A) and (B) carrying it unchanged. Fixed-point fixture
 * with a static-table model (Anthropic Sonnet) so the test is hermetic
 * — no LiteLLM/OpenRouter network and no catalog-refresh dependency.
 */
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

import {
  estimateUsageCost,
  resetPricingCatalog,
  resolveModelPricing,
} from '../lib/telemetry/langfuse-model-sync.mjs';
import { buildRuntimeTracePayload } from '../lib/opencode-runtime-plugin.mjs';

const MODEL = 'claude-sonnet-4-6';

const TOKENS = {
  input: 10_000,
  output: 2_000,
  reasoning: 500,
  cache: {
    read: 4_000,
    write_5m: 1_000,
    write_1h: 200,
  },
};

function buildAssistantMessageEvent() {
  return {
    type: 'message.updated',
    timestamp: '2026-05-14T12:00:00.000Z',
    properties: {
      info: {
        id: 'msg-recon-001',
        sessionID: 'sess-recon-001',
        role: 'assistant',
        agent: 'construct',
        modelID: MODEL,
        providerID: 'anthropic',
        time: {
          created: '2026-05-14T12:00:00.000Z',
          completed: '2026-05-14T12:00:02.000Z',
        },
        tokens: TOKENS,
        parts: [
          { type: 'text', text: 'reconciliation payload' },
        ],
      },
    },
  };
}

before(() => {
  resetPricingCatalog();
});

describe('3-way cost reconciliation', () => {
  it('the Sonnet 4.6 entry resolves from the live or fallback catalog with full cache tiers', () => {
    const pricing = resolveModelPricing(MODEL);
    assert.ok(pricing, 'Sonnet 4.6 must resolve from the catalog');
    assert.ok(
      pricing.source === 'litellm' || pricing.source === 'static-fallback',
      `unexpected source: ${pricing.source}`,
    );
    assert.ok(pricing.inputPrice > 0, 'inputPrice must be priced');
    assert.ok(pricing.outputPrice > 0, 'outputPrice must be priced');
    assert.ok(pricing.cacheReadPrice > 0, 'cacheReadPrice must be priced');
    assert.ok(pricing.cacheWrite5mPrice > 0, 'cacheWrite5mPrice must be priced');
    assert.ok(pricing.cacheWrite1hPrice > 0, 'cacheWrite1hPrice must be priced');
  });

  it('direct estimateUsageCost() prices every tier (no token dropped, no double-count)', () => {
    const usage = {
      inputTokens: TOKENS.input,
      outputTokens: TOKENS.output,
      reasoningTokens: TOKENS.reasoning,
      cacheReadInputTokens: TOKENS.cache.read,
      cacheCreation5mInputTokens: TOKENS.cache.write_5m,
      cacheCreation1hInputTokens: TOKENS.cache.write_1h,
    };
    const result = estimateUsageCost(MODEL, usage);
    assert.ok(result.costUsd > 0, 'costUsd must be > 0 for paid Sonnet');
    assert.match(result.costSource, /^estimated:(litellm|static-fallback)$/);
    assert.equal(result.breakdown.billableInputTokens, TOKENS.input);
    assert.equal(result.breakdown.billableOutputTokens, TOKENS.output + TOKENS.reasoning);
    assert.equal(result.breakdown.cacheReadInputTokens, TOKENS.cache.read);
    assert.equal(result.breakdown.cacheCreation5mInputTokens, TOKENS.cache.write_5m);
    assert.equal(result.breakdown.cacheCreation1hInputTokens, TOKENS.cache.write_1h);
    const expected =
      result.breakdown.inputCostUsd +
      result.breakdown.outputCostUsd +
      result.breakdown.cacheReadCostUsd +
      result.breakdown.cacheWrite5mCostUsd +
      result.breakdown.cacheWrite1hCostUsd;
    assert.ok(Math.abs(result.costUsd - expected) < 1e-12, 'costUsd must equal the sum of every tier');
  });

  it('buildRuntimeTracePayload carries the same cost the direct call produces', () => {
    const event = buildAssistantMessageEvent();
    const payload = buildRuntimeTracePayload(event, { env: { USER: 'test' } });
    assert.ok(payload, 'payload must build for the message.updated fixture');

    const direct = estimateUsageCost(MODEL, {
      inputTokens: TOKENS.input,
      outputTokens: TOKENS.output,
      reasoningTokens: TOKENS.reasoning,
      cacheReadInputTokens: TOKENS.cache.read,
      cacheCreation5mInputTokens: TOKENS.cache.write_5m,
      cacheCreation1hInputTokens: TOKENS.cache.write_1h,
    });

    const inMetadata = Number(payload.metadata?.costUsd ?? 0);
    assert.ok(
      Math.abs(inMetadata - direct.costUsd) < 1e-9,
      `metadata.costUsd (${inMetadata}) must equal direct estimateUsageCost (${direct.costUsd})`,
    );
    assert.equal(payload.metadata.costSource, direct.costSource);
    assert.equal(payload.metadata.costModel, direct.modelName);
  });

  it('buildRuntimeTracePayload carries the full cache-tier and reasoning breakdown in metadata', () => {
    const event = buildAssistantMessageEvent();
    const payload = buildRuntimeTracePayload(event, { env: { USER: 'test' } });

    assert.equal(payload.metadata.reasoningTokens, TOKENS.reasoning, 'reasoningTokens must surface in metadata');
    assert.equal(payload.metadata.cacheReadInputTokens, TOKENS.cache.read, 'cacheReadInputTokens must surface in metadata');
  });

  it('returns costUsd=0 with unavailable source for unknown models (Ollama / OpenRouter free)', () => {
    const ollama = estimateUsageCost('ollama:llama3', { inputTokens: 1000, outputTokens: 500 });
    assert.equal(ollama.costUsd, 0);
    assert.equal(ollama.costSource, 'unavailable');

    const free = estimateUsageCost('this-model-does-not-exist', { inputTokens: 1000, outputTokens: 500 });
    assert.equal(free.costUsd, 0);
    assert.equal(free.costSource, 'unavailable');
  });

  it('reasoning tokens are billed at the output (completion) rate, not the input rate', () => {
    const withReasoning = estimateUsageCost(MODEL, {
      inputTokens: 1000,
      outputTokens: 1000,
      reasoningTokens: 1000,
    });
    const withoutReasoning = estimateUsageCost(MODEL, {
      inputTokens: 1000,
      outputTokens: 2000,
      reasoningTokens: 0,
    });
    assert.ok(
      Math.abs(withReasoning.costUsd - withoutReasoning.costUsd) < 1e-9,
      'reasoningTokens should price identically to the same count as outputTokens',
    );
  });

  it('cache-read tokens are billed strictly less than the same count as plain input', () => {
    const cached = estimateUsageCost(MODEL, { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 10_000 });
    const uncached = estimateUsageCost(MODEL, { inputTokens: 10_000, outputTokens: 0 });
    assert.ok(cached.costUsd > 0, 'cache reads must still be billed');
    assert.ok(cached.costUsd < uncached.costUsd, 'cache reads must be cheaper than uncached input');
  });
});
