/**
 * tests/certification/specialist-status-aggregation.test.mjs — construct-72gqn.14 (H2.2).
 *
 * Pins the per-specialist status fix: the v1 status rolled one shared scenario verdict onto
 * every specialist row (and looked up a scenario id that never existed). These test that
 * each specialist now selects only its OWN scenarios and aggregates worst-of, so two
 * specialists with different verdicts read differently instead of being smeared.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { specialistScenarioIds, aggregateSpecialistStatus } from '../../lib/certification/status.mjs';

const CATALOG = [
  { id: 'specialist.representative.architect' },
  { id: 'specialist.adversarial.architect' },
  { id: 'specialist.live.architect.representative' },
  { id: 'specialist.representative.engineer' },
  { id: 'specialist.adversarial.engineer' },
  { id: 'specialist.prompt.normal' },
  { id: 'artifact.release-gate.prd' },
];

test('specialistScenarioIds selects only that specialist own hermetic + live scenarios', () => {
  const architect = specialistScenarioIds(CATALOG, 'architect');
  assert.deepEqual(
    architect.sort(),
    ['specialist.adversarial.architect', 'specialist.live.architect.representative', 'specialist.representative.architect'],
  );
  const engineer = specialistScenarioIds(CATALOG, 'engineer');
  assert.deepEqual(engineer.sort(), ['specialist.adversarial.engineer', 'specialist.representative.engineer']);
  // 'specialist.prompt.normal' and the artifact scenario belong to no specialist row.
  assert.ok(!architect.includes('specialist.prompt.normal'));
});

test('aggregateSpecialistStatus is worst-of over a specialist own runs', () => {
  const run = (status) => ({ verdict: { status }, createdAt: '2026-07-14T00:00:00Z' });
  assert.equal(aggregateSpecialistStatus([]).status, 'never-run');
  assert.equal(aggregateSpecialistStatus([run('pass'), run('pass')]).status, 'pass');
  assert.equal(aggregateSpecialistStatus([run('pass'), run('inconclusive')]).status, 'inconclusive');
  assert.equal(aggregateSpecialistStatus([run('pass'), run('inconclusive'), run('fail')]).status, 'fail');
});

test('two specialists with different verdicts do not smear onto each other', () => {
  const byScenario = new Map([
    ['specialist.representative.architect', { verdict: { status: 'pass' }, createdAt: '2026-07-14T00:00:00Z' }],
    ['specialist.representative.engineer', { verdict: { status: 'fail' }, createdAt: '2026-07-14T00:00:00Z' }],
  ]);
  const architectRuns = specialistScenarioIds(CATALOG, 'architect').map((id) => byScenario.get(id)).filter(Boolean);
  const engineerRuns = specialistScenarioIds(CATALOG, 'engineer').map((id) => byScenario.get(id)).filter(Boolean);
  assert.equal(aggregateSpecialistStatus(architectRuns).status, 'pass');
  assert.equal(aggregateSpecialistStatus(engineerRuns).status, 'fail');
});
