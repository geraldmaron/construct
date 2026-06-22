/**
 * tests/certification-eval-gates.test.mjs — eval gate integration in certification runs.
 *
 * @capability test-system.certification-eval-gates
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { decidePromotion } from '../lib/evals/gates.mjs';
import { runScenarioEvalGates } from '../lib/certification/eval-bridge.mjs';
import { getScenario } from '../lib/certification/scenarios.mjs';
import { runCertificationScenario } from '../lib/certification/runner.mjs';

test('hermetic scenario includes eval gates with evidence pointers', async () => {
  const { scenario } = getScenario('ledger.traceability', { repoRoot: process.cwd() });
  const { evalGates } = runScenarioEvalGates(scenario);
  assert.ok(evalGates.length >= 6);
  assert.ok(evalGates.every((gate) => gate.id.startsWith('eval:')));
  assert.ok(evalGates.every((gate) => typeof gate.evidence === 'string' && gate.evidence.startsWith('fixture:')));
  assert.ok(evalGates.every((gate) => gate.pass === true));
});

test('deterministic regression blocks certification promotion', async () => {
  const { scenario } = getScenario('ledger.traceability', { repoRoot: process.cwd() });
  scenario.eval = {
    candidate: {
      contractResult: { outcome: 'fail' },
      citedSourceIds: [`cert-fixture:${scenario.fixture.path}`],
      evidence: { provided: true },
      toolsUsed: ['read'],
      permissionViolations: [],
      cost: 0,
      latencyMs: 0,
      output: {},
      outputStructured: true,
    },
  };
  const { deterministic } = runScenarioEvalGates(scenario);
  assert.equal(deterministic.blocked, true);
  assert.ok(deterministic.regressions.includes('contract-schema'));
  const promotion = decidePromotion({ deterministic, judges: [{ verdict: 'pass' }] });
  assert.equal(promotion.promotable, false);
});

test('judges veto only and never grant pass alone', async () => {
  const { scenario } = getScenario('ledger.traceability', { repoRoot: process.cwd() });
  const { deterministic } = runScenarioEvalGates(scenario);

  assert.equal(decidePromotion({ deterministic: null, judges: [{ verdict: 'pass' }] }).promotable, false);
  assert.equal(decidePromotion({ deterministic, judges: [{ verdict: 'fail', model: 'judge-a' }] }).promotable, false);
  assert.equal(decidePromotion({ deterministic, judges: [] }).promotable, true);
});

test('certification run persists evaluation report and judge metadata', async (t) => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cert-eval-gates-'));
  t.after(() => fs.rmSync(rootDir, { recursive: true, force: true }));
  const judges = [{
    verdict: 'pass',
    model: 'openrouter/test-judge',
    rubricVersion: 'cert-r1',
    promptVersion: 'p1',
    repetitions: 2,
  }];
  const result = await runCertificationScenario('ledger.traceability', {
    projectDir: rootDir,
    repoRoot: process.cwd(),
    judges,
  });
  assert.ok(result.run.evaluation);
  assert.equal(result.run.evaluation.decision.promotable, true);
  assert.equal(result.run.evaluation.evaluators[0].model, 'openrouter/test-judge');
  assert.equal(result.run.evaluation.evaluators[0].rubricVersion, 'cert-r1');
  assert.ok(result.run.gates.some((gate) => gate.id === 'eval:contract-schema'));
  assert.ok(result.run.qualitative);
  assert.equal(result.run.qualitative.judgeModel, 'openrouter/test-judge');
});

test('judge fail withholds pass even when deterministic gates pass', async (t) => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cert-eval-judge-veto-'));
  t.after(() => fs.rmSync(rootDir, { recursive: true, force: true }));
  const result = await runCertificationScenario('ledger.traceability', {
    projectDir: rootDir,
    repoRoot: process.cwd(),
    judges: [{ verdict: 'fail', model: 'openrouter/test-judge' }],
  });
  assert.equal(result.run.verdict.status, 'fail');
  assert.equal(result.run.evaluation.decision.promotable, false);
});
