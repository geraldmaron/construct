/**
 * tests/cost.test.mjs — validates token and cache accounting.
 *
 * Covers canonical Anthropic cache fields and per-agent aggregation so
 * CLI/status reports cannot show impossible rates.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { aggregateCostByAgent, computeCacheStats, normalizeCostEntry, summarizeCostData } from '../lib/cost.mjs';

test('modern cache fields compute a bounded cache read rate', () => {
  const entry = normalizeCostEntry({
    input_tokens: 100,
    output_tokens: 20,
    cache_read_input_tokens: 300,
    cache_creation_input_tokens: 50,
    cache_creation_5m_input_tokens: 30,
    cache_creation_1h_input_tokens: 20,
    cost_usd: 0.01,
  });

  assert.equal(entry.inputTokens, 100);
  assert.equal(entry.outputTokens, 20);
  assert.equal(entry.cacheReadInputTokens, 300);
  assert.equal(entry.cacheCreationInputTokens, 50);
  assert.equal(entry.processedInputTokens, 450);

  const stats = computeCacheStats([entry]);
  assert.equal(stats.totalProcessedInputTokens, 450);
  assert.equal(stats.totalCacheReadInputTokens, 300);
  assert.equal(stats.cacheReadRate, 0.667);
  assert.ok(stats.cacheReadRate <= 1);
});

test('non-canonical cached_tokens fields are ignored', () => {
  const data = summarizeCostData([
    {
      ts: '2026-04-18T00:00:00.000Z',
      input_tokens: 1,
      output_tokens: 10,
      cached_tokens: 100_000,
      cost_usd: 0.001,
      agent: 'construct',
    },
  ]);

  assert.equal(data.totalInputTokens, 1);
  assert.equal(data.cacheReadRate, 0);
  assert.equal(data.cachedTokens, 0);
  assert.ok(data.cacheReadRate <= 1);
});

test('per-agent aggregation uses normalized token values', () => {
  const byAgent = aggregateCostByAgent([
    { agent: 'cx-engineer', inputTokens: 100, outputTokens: 20, cacheReadInputTokens: 300, cacheCreationInputTokens: 50, costUsd: 0.02 },
    { agent: 'cx-engineer', input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 40, cost_usd: 0.01 },
  ]);

  assert.equal(byAgent.length, 1);
  assert.equal(byAgent[0].inputTokens, 110);
  assert.equal(byAgent[0].outputTokens, 25);
  assert.equal(byAgent[0].cacheReadInputTokens, 340);
  assert.equal(byAgent[0].processedInputTokens, 500);
  assert.equal(byAgent[0].cacheReadRate, 0.68);
});
