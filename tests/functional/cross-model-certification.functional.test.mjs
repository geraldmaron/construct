/**
 * tests/functional/cross-model-certification.functional.test.mjs — cross-model metrics path.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  freshContextJudgeEvidence,
  runCrossModelCertification,
} from '../../lib/certification/cross-model-certification.mjs';

test('mocked multi-tier run produces cost, latency, and variance per tier', async () => {
  const tiers = [
    { id: 'mock-a', tier: 'free', resolvedId: 'mock/free-a' },
    { id: 'mock-b', tier: 'free', resolvedId: 'mock/free-b' },
  ];
  const report = await runCrossModelCertification({
    tiers,
    repeats: 3,
    invokeScenario: async ({ tier, repeat }) => ({
      score: 0.7 + repeat * 0.05 + (tier.id === 'mock-b' ? 0.02 : 0),
      costUsd: tier.id === 'mock-b' ? 0.001 : 0,
      usage: { promptTokens: 100 + repeat, completionTokens: 20 + repeat },
    }),
  });

  assert.equal(report.pass, true);
  assert.equal(report.tiers.length, 2);
  for (const tier of report.tiers) {
    assert.ok(typeof tier.latencyMs === 'number');
    assert.ok(typeof tier.cost.totalUsd === 'number');
    assert.ok(typeof tier.variance.scoreStdDev === 'number');
    assert.equal(tier.variance.repeats, 3);
    assert.ok(tier.freshContextJudge.alreadyFreshContext === true);
  }
});

test('fresh-context judge evidence cites real-llm polish path', () => {
  const evidence = freshContextJudgeEvidence();
  assert.match(evidence.citation, /real-llm-scenarios\.mjs:124-141/);
});
