/**
 * tests/langfuse-model-sync.test.mjs — validates model pricing catalog and cost estimation.
 *
 * Guards the cache pricing ratios, Haiku 4.5 rate correction, and Anthropic-over-OpenRouter
 * precedence so direct-Anthropic users are not priced at OpenRouter markup.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildPricingCatalog,
  estimateUsageCost,
  resolveModelPricing,
  resetPricingCatalog,
} from '../lib/telemetry/langfuse-model-sync.mjs';

test('Haiku 4.5 is priced at $1/$5 per million tokens', () => {
  const catalog = buildPricingCatalog();
  const pricing = resolveModelPricing('claude-haiku-4-5', catalog);
  assert.ok(pricing, 'expected Haiku 4.5 to be in catalog');
  assert.equal(pricing.inputPrice, 1 / 1_000_000);
  assert.equal(pricing.outputPrice, 5 / 1_000_000);
});

test('Anthropic cache pricing ratios match published multipliers', () => {
  const catalog = buildPricingCatalog();
  const pricing = resolveModelPricing('claude-opus-4-7', catalog);
  assert.ok(pricing);
  // cache_read = 0.10x input, cache_write_5m = 1.25x, cache_write_1h = 2.0x
  assert.ok(Math.abs(pricing.cacheReadPrice - pricing.inputPrice * 0.1) < 1e-18);
  assert.ok(Math.abs(pricing.cacheWrite5mPrice - pricing.inputPrice * 1.25) < 1e-18);
  assert.ok(Math.abs(pricing.cacheWrite1hPrice - pricing.inputPrice * 2.0) < 1e-18);
});

test('estimateUsageCost includes cache read and cache write surcharges', () => {
  const catalog = buildPricingCatalog();
  const result = estimateUsageCost('claude-opus-4-7', {
    inputTokens: 1_000,
    outputTokens: 500,
    cacheReadInputTokens: 10_000,
    cacheCreation5mInputTokens: 2_000,
    cacheCreation1hInputTokens: 1_000,
  }, catalog);

  // Opus 4.7: input $15/M, output $75/M => 0.10x=$1.5/M, 1.25x=$18.75/M, 2x=$30/M
  const expected =
    1_000 * 15 / 1_000_000 +
    10_000 * 1.5 / 1_000_000 +
    2_000 * 18.75 / 1_000_000 +
    1_000 * 30 / 1_000_000 +
    500 * 75 / 1_000_000;
  assert.ok(Math.abs(result.costUsd - expected) < 1e-9, `got ${result.costUsd} expected ${expected}`);
  assert.ok(Math.abs(result.breakdown.cacheReadCostUsd - 10_000 * 1.5 / 1_000_000) < 1e-12);
});

test('estimateUsageCost bills reasoning tokens at the output rate', () => {
  const catalog = buildPricingCatalog();
  const result = estimateUsageCost('claude-sonnet-4-6', {
    inputTokens: 100,
    outputTokens: 200,
    reasoningTokens: 300,
  }, catalog);
  // Sonnet 4.6: $3/$15 per M. Billed output = 500 tokens * $15/M.
  const expected = 100 * 3 / 1_000_000 + 500 * 15 / 1_000_000;
  assert.ok(Math.abs(result.costUsd - expected) < 1e-12);
});

test('residual cache_creation tokens default to 5m pricing', () => {
  const catalog = buildPricingCatalog();
  const result = estimateUsageCost('claude-sonnet-4-6', {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 1_000, // aggregate only, no 5m/1h split
  }, catalog);
  // Sonnet input $3/M -> 5m write = $3.75/M.
  const expected = 1_000 * 3.75 / 1_000_000;
  assert.ok(Math.abs(result.costUsd - expected) < 1e-12);
});

test('unknown model returns zero cost with unavailable source', () => {
  const result = estimateUsageCost('totally-unknown-model', { inputTokens: 100 });
  assert.equal(result.costUsd, 0);
  assert.equal(result.costSource, 'unavailable');
});

test('static Anthropic pricing overrides OpenRouter when model is in static table', () => {
  // OpenRouter quotes a marked-up rate for a model already in the static table.
  const openRouterModels = [
    {
      modelName: 'claude-haiku-4-5',
      matchPattern: '(?i)^claude-haiku-4-5$',
      inputPrice: 9 / 1_000_000,   // inflated
      outputPrice: 45 / 1_000_000,
    },
  ];
  const catalog = buildPricingCatalog(openRouterModels);
  const pricing = resolveModelPricing('claude-haiku-4-5', catalog);
  assert.equal(pricing.source, 'static');
  assert.equal(pricing.inputPrice, 1 / 1_000_000);
  assert.equal(pricing.outputPrice, 5 / 1_000_000);
});

test('OpenRouter-only model uses OpenRouter pricing when not in static table', () => {
  const openRouterModels = [
    {
      modelName: 'openrouter/some-new-model',
      matchPattern: '(?i)^openrouter/some-new-model$',
      inputPrice: 2 / 1_000_000,
      outputPrice: 8 / 1_000_000,
    },
  ];
  const catalog = buildPricingCatalog(openRouterModels);
  const pricing = resolveModelPricing('openrouter/some-new-model', catalog);
  assert.equal(pricing.source, 'openrouter');
  assert.equal(pricing.inputPrice, 2 / 1_000_000);
});

test('LiteLLM pricing is overridden by static table for known models', () => {
  const litellmModels = [
    {
      modelName: 'claude-haiku-4-5',
      matchPattern: '(?i)^claude-haiku-4-5$',
      inputPrice: 0.5 / 1_000_000,  // stale/wrong rate
      outputPrice: 2 / 1_000_000,
    },
  ];
  const catalog = buildPricingCatalog([], litellmModels);
  const pricing = resolveModelPricing('claude-haiku-4-5', catalog);
  // Static must win.
  assert.equal(pricing.source, 'static');
  assert.equal(pricing.inputPrice, 1 / 1_000_000);
  resetPricingCatalog();
});
