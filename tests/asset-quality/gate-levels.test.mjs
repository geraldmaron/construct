/**
 * tests/asset-quality/gate-levels.test.mjs — Guards the gate-level registry and level-aware gate.
 *
 * Levels are cumulative, fast carries only the source-lint check so it stays cheap, and a pending
 * (not-yet-implemented) category is never reported as running — it surfaces with its bead instead.
 * runGateAtLevel resolves the level from the artifact's qualityContract and runs the checks that
 * exist today while reporting what higher tiers still owe.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  categoriesForLevel,
  planGateForLevel,
  resolveGateLevel,
  CHECK_CATEGORIES,
  DEFAULT_GATE_LEVEL,
} from '../../lib/artifact-gate-levels.mjs';
import { runGateAtLevel } from '../../lib/artifact-release-gate.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const golden = (type) => join(REPO, 'tests/fixtures/artifacts', type, 'golden.md');

test('levels are cumulative: each level is a superset of the cheaper one below it', () => {
  const fast = categoriesForLevel('fast');
  const standard = categoriesForLevel('standard');
  const renderSmoke = categoriesForLevel('render-smoke');
  assert.deepEqual(fast, ['source-lint']);
  assert.ok(fast.every((c) => standard.includes(c)));
  assert.ok(standard.every((c) => renderSmoke.includes(c)));
});

test('fast carries only the available source-lint check, with nothing pending', () => {
  const plan = planGateForLevel('fast');
  assert.deepEqual(plan.runs, ['source-lint']);
  assert.deepEqual(plan.pending, []);
});

test('a pending category never appears in runs — it surfaces with its bead', () => {
  const plan = planGateForLevel('render-smoke');
  for (const category of plan.runs) {
    assert.equal(CHECK_CATEGORIES[category].status, 'available', `${category} is not available`);
  }
  for (const entry of plan.pending) {
    assert.equal(CHECK_CATEGORIES[entry.category].status, 'pending');
    assert.ok(typeof entry.bead === 'string' && entry.bead.length > 0, `${entry.category} has no bead`);
  }
  assert.ok(plan.pending.some((e) => e.category === 'render-screenshot'));
});

test('resolveGateLevel reads qualityContract.gateLevel and defaults safely', () => {
  assert.equal(resolveGateLevel({ gateLevel: 'full-certification' }), 'full-certification');
  assert.equal(resolveGateLevel(undefined), DEFAULT_GATE_LEVEL);
  assert.equal(resolveGateLevel({ gateLevel: 'turbo' }), DEFAULT_GATE_LEVEL);
});

test('runGateAtLevel resolves a per-artifact level and reports what is owed', () => {
  const prd = runGateAtLevel({ filePath: golden('prd'), type: 'prd', rootDir: REPO });
  assert.equal(prd.gateLevel, 'render-smoke');
  assert.equal(prd.ok, true);
  assert.deepEqual(prd.gatePlan.runs, ['source-lint']);
  assert.ok(prd.gatePlan.pending.some((e) => e.category === 'contrast'));

  const adr = runGateAtLevel({ filePath: golden('adr'), type: 'adr', rootDir: REPO });
  assert.equal(adr.gateLevel, 'standard');
  assert.ok(adr.gatePlan.pending.some((e) => e.category === 'export-validation'));
});

test('an explicit fast level runs cheap and owes nothing on a passing artifact', () => {
  const result = runGateAtLevel({ filePath: golden('adr'), type: 'adr', level: 'fast', rootDir: REPO });
  assert.equal(result.gateLevel, 'fast');
  assert.equal(result.ok, true);
  assert.deepEqual(result.gatePlan.pending, []);
});
