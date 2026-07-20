/**
 * tests/certification/oracle-false-success.test.mjs — Oracle false-success certification corpus.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  evaluateOracleFalseSuccessGate,
} from '../../lib/certification/oracle-false-success.mjs';
import { runCertificationScenario } from '../../lib/certification/runner.mjs';
import { runReleaseCandidateGate } from '../../lib/certification/rc-gate.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

for (const [scenarioId, catalogScenario] of [
  ['unreachable-sha-close', 'oracle.false-success.unreachable-sha'],
  ['closed-parent-open-children', 'oracle.false-success.closed-parent-open-children'],
  ['partial-graph-as-clean', 'oracle.false-success.partial-graph'],
  ['ignored-impact-context', 'oracle.false-success.ignored-impact-context'],
]) {
  test(`oracle false-success scenario ${scenarioId} catches injected condition`, async () => {
    const result = await runCertificationScenario(catalogScenario, { repoRoot: REPO, projectDir: REPO });
    assert.equal(result.run.verdict.status, 'pass', result.run.verdict.reason ?? JSON.stringify(result.run.gates));
    const gate = result.run.gates.find((g) => g.scenarioId === scenarioId) ?? result.run.gates[0];
    assert.equal(gate?.pass, true, gate?.detail ?? 'gate did not pass');
    assert.ok(gate?.oracleVerdict, 'expected oracleVerdict on gate result');
    assert.notEqual(gate.oracleVerdict, 'healthy', 'Oracle must not return healthy on false-success fixture');
  });
}

test('evaluateOracleFalseSuccessGate passes when Oracle catches all four scenarios', async () => {
  const result = await evaluateOracleFalseSuccessGate({ rootDir: REPO });
  assert.equal(result.pass, true, result.errors.join('\n'));
  assert.equal(result.scenarioCount, 4);
  assert.equal(result.checks.filter((c) => c.pass).length, 4);
});

test('release gate blocks when Oracle false-success scenario is deliberately regressed', async () => {
  const baseline = await evaluateOracleFalseSuccessGate({ rootDir: REPO });
  assert.equal(baseline.pass, true, baseline.errors.join('\n'));

  const regressed = await evaluateOracleFalseSuccessGate({
    rootDir: REPO,
    simulateRegressionOn: 'partial-graph-as-clean',
  });
  assert.equal(regressed.pass, false);
  assert.ok(
    regressed.errors.some((err) => err.includes('oracle.false-success.partial-graph')),
    regressed.errors.join('\n'),
  );
});

test('runReleaseCandidateGate includes oracle false-success sub-gate', async () => {
  const result = await runReleaseCandidateGate({ rootDir: REPO, runHermetic: false });
  const oracleChecks = result.checks.filter((c) => c.kind === 'oracle-false-success');
  assert.equal(oracleChecks.length, 4);
  assert.ok(result.oracleFalseSuccessScenarioCount === 4);
  assert.ok(
    result.pass || result.errors.some((err) => !err.includes('oracle false-success')),
    `unexpected oracle false-success failure: ${result.errors.join('\n')}`,
  );
});
