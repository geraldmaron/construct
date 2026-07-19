/**
 * tests/skills/experimentation.test.mjs — construct-72gqn.32 (H5-deep).
 *
 * Pins the experimentation skill and the cross-role entitlement broadening: the
 * one overlay-trapped cross-role methodology (perspectives/data-analyst.experiment was
 * a 3-item anti-pattern lens with no domain how-to) is now a first-class domain
 * skill, entitled to every role that actually runs experiments (analyst,
 * engineer, PM, operations) and routable — not reachable only through one
 * role's private overlay. Also pins that prioritization-methods and
 * market-research-methods reach their full cross-role set.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateSkillEffectiveness } from '../../lib/validators/skill-effectiveness.mjs';
import { suggestSkills } from '../../lib/skills/router.mjs';
import { loadRegistry } from '../../lib/registry/loader.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SKILL = 'strategy/experimentation';

function entitled(reg, specialistId) {
  const s = reg.specialists[specialistId] ?? Object.values(reg.specialists).find((x) => `cx-${x.name}` === specialistId);
  return new Set(s?.skills ?? []);
}

test('the experimentation skill exists and passes the effectiveness lint', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'skills', `${SKILL}.md`)));
  const { errors } = validateSkillEffectiveness({ rootDir: ROOT });
  assert.deepEqual(errors.filter((e) => e.includes('experimentation')), []);
});

test('experimentation is entitled to every role that runs experiments', () => {
  const reg = loadRegistry({ rootDir: ROOT });
  for (const id of ['data-analyst', 'engineer', 'product-manager', 'operations']) {
    assert.ok(entitled(reg, id).has(SKILL), `${id} entitles ${SKILL}`);
  }
});

test('experiment intents route to the skill in the top 3', () => {
  const intents = [
    'design an a/b test for onboarding',
    'what sample size do we need',
    'set up a canary rollout',
    'minimum detectable effect for this experiment',
    'should we run a holdout',
  ];
  for (const intent of intents) {
    const { suggestions } = suggestSkills({ intent, rootDir: ROOT, limit: 3 });
    const rank = suggestions.findIndex((s) => s.path === SKILL);
    assert.ok(rank >= 0 && rank < 3, `"${intent}" routes ${SKILL} in the top 3 (rank ${rank})`);
  }
});

test('an unrelated intent does not misfire the skill', () => {
  const { suggestions } = suggestSkills({ intent: 'refactor the CSS grid layout', rootDir: ROOT, limit: 5 });
  assert.ok(!suggestions.some((s) => s.path === SKILL));
});

test('the cross-role broadening reaches its full set', () => {
  const reg = loadRegistry({ rootDir: ROOT });
  for (const id of ['product-manager', 'orchestrator', 'operations']) {
    assert.ok(entitled(reg, id).has('strategy/prioritization-methods'), `${id} entitles prioritization-methods`);
  }
  for (const id of ['data-analyst', 'product-manager', 'researcher']) {
    assert.ok(entitled(reg, id).has('strategy/market-research-methods'), `${id} entitles market-research-methods`);
  }
});
