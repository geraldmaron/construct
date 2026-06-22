/**
 * tests/functional/eval-gates.functional.test.mjs — the independent evaluation
 * gate seam (construct-6zga.1.6).
 *
 * Exercises the real modules end to end (dataset item -> deterministic gates ->
 * promotion decision -> report) and proves the governance invariants:
 *   - a held-out item is selected with the candidate's generating trace removed (AC2).
 *   - any deterministic regression — fabricated source, disallowed tool, busted
 *     budget, wrong contract outcome — blocks promotion (AC3).
 *   - judges never stand alone: they cannot override a deterministic block and
 *     cannot promote without a passing deterministic result; a fail verdict can
 *     only withhold (AC4).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { validateDatasetItem, selectEvalSet } from '../../lib/evals/dataset.mjs';
import { runDeterministicGates, decidePromotion, buildEvaluationReport } from '../../lib/evals/gates.mjs';

const ITEM = {
  schemaVersion: 1,
  id: 'held-out-1',
  taskFamily: 'repo-summary',
  taskInput: { prompt: 'summarize the auth module', intent: 'investigation', risk: 'low' },
  capabilitySnapshot: { capabilityClass: 'hosted-direct', transport: 'direct', operatingProfileId: 'balanced' },
  allowedTools: ['read', 'search', 'construct'],
  expectedEvidenceBehavior: { requirement: 'required', citationsRequired: true },
  expectedContractResult: { outcome: 'pass' },
  redaction: { state: 'raw', fields: [] },
  sourceTraceIds: ['trace-500'],
  humanLabel: { provenance: 'human', labeledBy: 'gd', rubricVersion: 'r1', correctionId: null },
  split: 'test',
  expiry: null,
};

const BUDGETS = { maxCost: 0.5, maxLatencyMs: 30000 };

function goodCandidate(over = {}) {
  return {
    contractResult: { outcome: 'pass' },
    citedSourceIds: ['trace-500'],
    evidence: { provided: true },
    toolsUsed: ['read', 'search'],
    permissionViolations: [],
    cost: 0.2,
    latencyMs: 12000,
    output: { summary: 'ok' },
    outputStructured: true,
    ...over,
  };
}

test('a held-out item is selected with the generating trace removed (AC1, AC2)', () => {
  assert.ok(validateDatasetItem(ITEM).valid);
  const pool = [ITEM, { ...ITEM, id: 'gen', sourceTraceIds: ['trace-gen'] }];
  const candidate = { generatingTraceIds: ['trace-gen'], taskInput: { prompt: 'a different question' } };
  const evalSet = selectEvalSet(pool, candidate, { split: 'test', nowIso: '2026-06-21' }).map((i) => i.id);
  assert.ok(evalSet.includes('held-out-1'));
  assert.ok(!evalSet.includes('gen'), 'the generating trace must be held out');
});

test('a clean candidate passes every deterministic gate and is promotable', () => {
  const deterministic = runDeterministicGates(goodCandidate(), ITEM, BUDGETS);
  assert.equal(deterministic.blocked, false, deterministic.regressions.join(','));
  const decision = decidePromotion({ deterministic, judges: [{ verdict: 'pass', model: 'claude' }] });
  assert.equal(decision.promotable, true);
});

test('each deterministic regression blocks promotion (AC3)', () => {
  const cases = [
    ['fabricated source', goodCandidate({ citedSourceIds: ['trace-999'] }), 'source-provenance'],
    ['disallowed tool', goodCandidate({ toolsUsed: ['read', 'shell'] }), 'tool-use'],
    ['busted budget', goodCandidate({ cost: 9.0 }), 'cost-latency'],
    ['wrong contract outcome', goodCandidate({ contractResult: { outcome: 'fail' } }), 'contract-schema'],
    ['permission violation', goodCandidate({ permissionViolations: ['escaped-sandbox'] }), 'safety-permission'],
  ];
  for (const [label, candidate, expectedGate] of cases) {
    const deterministic = runDeterministicGates(candidate, ITEM, BUDGETS);
    assert.equal(deterministic.blocked, true, `${label}: expected a block`);
    assert.ok(deterministic.regressions.includes(expectedGate), `${label}: expected ${expectedGate} regression`);
    const decision = decidePromotion({ deterministic, judges: [{ verdict: 'pass' }] });
    assert.equal(decision.promotable, false, `${label}: a passing judge must not override the block`);
  }
});

test('judges never stand alone (AC4)', () => {
  const passing = runDeterministicGates(goodCandidate(), ITEM, BUDGETS);

  assert.equal(decidePromotion({ deterministic: null, judges: [{ verdict: 'pass' }] }).promotable, false, 'a judge alone cannot promote');
  assert.equal(decidePromotion({ deterministic: passing, judges: [{ verdict: 'fail' }] }).promotable, false, 'a fail verdict withholds promotion');
  assert.equal(decidePromotion({ deterministic: passing, judges: [] }).promotable, true, 'deterministic pass with no objection promotes');
});

test('the report carries baseline/candidate deltas and evaluator metadata (AC4)', () => {
  const baseline = goodCandidate({ cost: 0.4, latencyMs: 20000 });
  const candidate = goodCandidate({ cost: 0.2, latencyMs: 12000 });
  const deterministic = runDeterministicGates(candidate, ITEM, BUDGETS);
  const report = buildEvaluationReport({
    baseline, candidate, deterministic,
    judges: [{ verdict: 'pass', model: 'claude-opus', rubricVersion: 'r2', repetitions: 3 }],
  });
  assert.equal(report.deltas.cost.delta, -0.2);
  assert.equal(report.deltas.latencyMs.delta, -8000);
  assert.equal(report.evaluators[0].rubricVersion, 'r2');
  assert.equal(report.evaluators[0].repetitions, 3);
  assert.equal(report.decision.promotable, true);
});
