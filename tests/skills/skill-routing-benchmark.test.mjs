/**
 * tests/skills/skill-routing-benchmark.test.mjs — skill-routing retrieval regression gate.
 *
 * Runs lib/skills/routing-bench.mjs's benchmark against
 * tests/fixtures/skill-routing/intents.json and asserts the recall@5 floor
 * plus zero mustNotInclude regressions — deterministic, no model calls, part
 * of the normal `npm test` CI gate (mirrors tests/engine-eval-retrieval.test.mjs's
 * pattern for the document-retrieval eval).
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { runSkillRoutingBench, formatBenchSummary, DEFAULT_THRESHOLDS } from '../../lib/skills/routing-bench.mjs';

const REPO = new URL('../..', import.meta.url).pathname;

test('skill-routing benchmark meets the recall@5 floor with zero false-positive regressions', async () => {
  const result = await runSkillRoutingBench({ rootDir: REPO });
  assert.ok(
    result.summary.recallAt5 >= DEFAULT_THRESHOLDS.minRecallAt5,
    `recall@5 regressed below floor ${DEFAULT_THRESHOLDS.minRecallAt5}. Got ${result.summary.recallAt5.toFixed(3)}\n${formatBenchSummary(result)}`,
  );
  assert.deepEqual(
    result.summary.regressed,
    [],
    `benchmark regressed: ${JSON.stringify(result.summary.regressed)}\n${formatBenchSummary(result)}`,
  );
});

test('every fixture query returns at least one suggestion or is an explicit false-positive probe', async () => {
  const result = await runSkillRoutingBench({ rootDir: REPO });
  for (const q of result.perQuery) {
    const isFpProbe = q.name.startsWith('fp-');
    if (!isFpProbe) {
      assert.ok(q.returnedIds.length > 0, `query "${q.name}" produced no suggestions at all`);
    }
  }
});
