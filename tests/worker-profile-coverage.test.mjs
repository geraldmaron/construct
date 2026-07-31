/**
 * tests/worker-profile-coverage.test.mjs.
 *
 * Pins the Worker Profile coverage floor: every registry profile must clear a
 * robustness minimum across four axes (skill emphasis, perspective,
 * guardrails, guidance). buildMatrix() reads the real registry so the test is a
 * durable guard against a future profile being added or trimmed below the
 * floor; evaluateFloor() is exercised directly so each failure mode is proven
 * to be caught, not just the current all-pass state.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildMatrix, evaluateFloor, FLOOR } from '../scripts/generate-worker-profile-coverage.mjs';

const CLEAN = {
  workerProfileId: 'example',
  skillsCount: FLOOR.minSkills,
  unresolved: [],
  perspectivePresent: true,
  refusalBoundaries: true,
  antiFabrication: true,
  fenceGatesCommitPush: true,
  promptPresent: true,
};

test('every registry Worker Profile clears the coverage floor', () => {
  const matrix = buildMatrix();
  assert.equal(matrix.workerProfileCount, 12, 'the canonical catalog has 12 Worker Profiles');
  const failing = matrix.workerProfiles.filter((r) => !r.pass);
  assert.deepEqual(
    failing.map((r) => `${r.workerProfileId}: ${r.fails.join('; ')}`),
    [],
    'no Worker Profile may sit below the robustness floor',
  );
  assert.equal(matrix.allPass, true);
});

test('guardrails are universal across Worker Profiles', () => {
  const matrix = buildMatrix();
  for (const r of matrix.workerProfiles) {
    assert.ok(r.guardrails.refusalBoundaries, `${r.workerProfileId} declares refusal boundaries`);
    assert.ok(r.guardrails.antiFabrication, `${r.workerProfileId} carries an anti-fabrication contract`);
    assert.ok(r.guardrails.fenceGatesCommitPush, `${r.workerProfileId} fences commit+push`);
  }
});

test('emphasized skills resolve and no Worker Profile is left thin', () => {
  const matrix = buildMatrix();
  for (const r of matrix.workerProfiles) {
    assert.deepEqual(r.skills.unresolved, [], `${r.workerProfileId} names only real skills`);
    assert.ok(r.skills.count >= FLOOR.minSkills, `${r.workerProfileId} has >= ${FLOOR.minSkills} skills`);
  }
});

test('key Worker Profiles carry their domain skills', () => {
  const matrix = buildMatrix();
  const byId = Object.fromEntries(matrix.workerProfiles.map((r) => [r.workerProfileId, r]));
  const qa = new Set(byId['qa'].skills.entitled);
  for (const s of ['quality-gates/verify-quality', 'quality-gates/review-work', 'quality-gates/premortem']) {
    assert.ok(qa.has(s), `qa now entitles ${s}`);
  }
  const dbg = new Set(byId['debugger'].skills.entitled);
  for (const s of ['exploration/unknown-codebase-onboarding', 'exploration/dependency-graph-reading', 'ai/trace-triage']) {
    assert.ok(dbg.has(s), `debugger now entitles ${s}`);
  }
  const da = new Set(byId['data-analyst'].skills.entitled);
  for (const s of ['strategy/market-research-methods', 'devops/data-engineering']) {
    assert.ok(da.has(s), `data-analyst now entitles ${s}`);
  }
});

test('evaluateFloor passes a clean row and catches each failure mode', () => {
  assert.deepEqual(evaluateFloor(CLEAN), [], 'a row meeting every minimum has no failures');

  assert.deepEqual(evaluateFloor({ ...CLEAN, skillsCount: 3 }), ['skills<5 (3)']);
  assert.deepEqual(evaluateFloor({ ...CLEAN, unresolved: ['ai/ghost'] }), ['unresolved-skills: ai/ghost']);
  assert.deepEqual(evaluateFloor({ ...CLEAN, perspectivePresent: false }), ['missing perspective perspectives/example']);
  assert.deepEqual(evaluateFloor({ ...CLEAN, refusalBoundaries: false }), ['no refusal boundary in prompt perspective.failureMode']);
  assert.deepEqual(evaluateFloor({ ...CLEAN, antiFabrication: false }), ['no anti-fabrication contract in prompt']);
  assert.deepEqual(evaluateFloor({ ...CLEAN, fenceGatesCommitPush: false }), ['fence does not gate commit+push']);
  assert.deepEqual(evaluateFloor({ ...CLEAN, promptPresent: false }), ['prompt file missing']);
});
