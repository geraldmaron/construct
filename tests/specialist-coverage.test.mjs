/**
 * tests/specialist-coverage.test.mjs — construct-72gqn.31 (H5-gen).
 *
 * Pins the specialist coverage floor: every registry specialist must clear a
 * robustness minimum across four axes (skill entitlements, role overlay,
 * guardrails, guidance). buildMatrix() reads the real registry so the test is a
 * durable guard against a future specialist being added or trimmed below the
 * floor; evaluateFloor() is exercised directly so each failure mode is proven
 * to be caught, not just the current all-pass state.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildMatrix, evaluateFloor, FLOOR } from '../scripts/generate-specialist-coverage.mjs';

const CLEAN = {
  role: 'example',
  skillsCount: FLOOR.minSkills,
  unresolved: [],
  overlayPresent: true,
  refusalBoundaries: true,
  antiFabrication: true,
  fenceGatesCommitPush: true,
  promptPresent: true,
  focusAreas: FLOOR.minFocusAreas,
};

test('every registry specialist clears the coverage floor', () => {
  const matrix = buildMatrix();
  assert.equal(matrix.specialistCount, 12, 'the consolidated roster is 12 specialists');
  const failing = matrix.specialists.filter((r) => !r.pass);
  assert.deepEqual(
    failing.map((r) => `${r.specialistId}: ${r.fails.join('; ')}`),
    [],
    'no specialist may sit below the robustness floor',
  );
  assert.equal(matrix.allPass, true);
});

test('guardrails are universal — refusalBoundaries + anti-fabrication + commit/push fence on every specialist', () => {
  const matrix = buildMatrix();
  for (const r of matrix.specialists) {
    assert.ok(r.guardrails.refusalBoundaries, `${r.specialistId} declares refusalBoundaries`);
    assert.ok(r.guardrails.antiFabrication, `${r.specialistId} carries an anti-fabrication contract`);
    assert.ok(r.guardrails.fenceGatesCommitPush, `${r.specialistId} fences commit+push`);
  }
});

test('entitled skills all resolve, and no specialist is left thin', () => {
  const matrix = buildMatrix();
  for (const r of matrix.specialists) {
    assert.deepEqual(r.skills.unresolved, [], `${r.specialistId} entitles only real skills`);
    assert.ok(r.skills.count >= FLOOR.minSkills, `${r.specialistId} has >= ${FLOOR.minSkills} skills`);
  }
});

test('the three specialists this bead re-scoped now carry their role-relevant skills', () => {
  const matrix = buildMatrix();
  const byId = Object.fromEntries(matrix.specialists.map((r) => [r.specialistId, r]));
  const qa = new Set(byId['cx-qa'].skills.entitled);
  for (const s of ['quality-gates/verify-quality', 'quality-gates/review-work', 'quality-gates/premortem']) {
    assert.ok(qa.has(s), `cx-qa now entitles ${s}`);
  }
  const dbg = new Set(byId['cx-debugger'].skills.entitled);
  for (const s of ['exploration/unknown-codebase-onboarding', 'exploration/dependency-graph-reading', 'ai/trace-triage']) {
    assert.ok(dbg.has(s), `cx-debugger now entitles ${s}`);
  }
  const da = new Set(byId['cx-data-analyst'].skills.entitled);
  for (const s of ['strategy/market-research-methods', 'devops/data-engineering']) {
    assert.ok(da.has(s), `cx-data-analyst now entitles ${s}`);
  }
});

test('evaluateFloor passes a clean row and catches each failure mode', () => {
  assert.deepEqual(evaluateFloor(CLEAN), [], 'a row meeting every minimum has no failures');

  assert.deepEqual(evaluateFloor({ ...CLEAN, skillsCount: 3 }), ['skills<5 (3)']);
  assert.deepEqual(evaluateFloor({ ...CLEAN, unresolved: ['ai/ghost'] }), ['unresolved-skills: ai/ghost']);
  assert.deepEqual(evaluateFloor({ ...CLEAN, overlayPresent: false }), ['missing role overlay roles/example']);
  assert.deepEqual(evaluateFloor({ ...CLEAN, refusalBoundaries: false }), ['no refusalBoundaries (prompt perspective.failureMode)']);
  assert.deepEqual(evaluateFloor({ ...CLEAN, antiFabrication: false }), ['no anti-fabrication contract in prompt']);
  assert.deepEqual(evaluateFloor({ ...CLEAN, fenceGatesCommitPush: false }), ['fence does not gate commit+push']);
  assert.deepEqual(evaluateFloor({ ...CLEAN, promptPresent: false }), ['prompt file missing']);
  assert.deepEqual(evaluateFloor({ ...CLEAN, focusAreas: 4 }), ['focusAreas<6 (4)']);
});
