/**
 * tests/skills/prioritization-methods.test.mjs — construct-72gqn.15 (H5).
 *
 * Pins the full wiring of the prioritization-methods skill that closed the one
 * cross-role authoring gap the coverage audit found: the skill passes the
 * effectiveness lint, is entitled to cx-product-manager, actually routes to the
 * top for prioritization intents (not just exists on disk), and both the
 * backlog-proposal and PRD templates point at it. The live behavioral proof —
 * a PM scenario asserting method + counterargument + uncertainty language —
 * lands with the H2 scenario schema (construct-72gqn.13/.14); this test locks
 * everything that does not depend on live model output.
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
const SKILL = 'strategy/prioritization-methods';

test('the skill exists and passes the effectiveness lint', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'skills', `${SKILL}.md`)), 'skill file on disk');
  const { errors } = validateSkillEffectiveness({ rootDir: ROOT });
  const mine = errors.filter((e) => e.includes('prioritization-methods'));
  assert.deepEqual(mine, [], 'no effectiveness-lint errors for the new skill');
});

test('cx-product-manager entitles the skill', () => {
  const reg = loadRegistry({ rootDir: ROOT });
  const pm = reg.specialists['cx-product-manager'] ?? Object.values(reg.specialists).find((s) => s.name === 'product-manager');
  assert.ok((pm.skills ?? []).includes(SKILL), 'PM skills[] entitles strategy/prioritization-methods');
});

test('prioritization intents route to the skill in the top 3', () => {
  const intents = [
    'how should we prioritize the backlog',
    'what should we build next quarter',
    'rice score for these features',
    'ranking the roadmap by cost of delay',
    'wsjf prioritization',
    'value versus effort tradeoff',
  ];
  for (const intent of intents) {
    const { suggestions } = suggestSkills({ intent, rootDir: ROOT, limit: 3 });
    const rank = suggestions.findIndex((s) => s.path === SKILL);
    assert.ok(rank >= 0 && rank < 3, `"${intent}" routes ${SKILL} in the top 3 (rank ${rank})`);
  }
});

test('a non-prioritization intent does not misfire the skill', () => {
  const { suggestions } = suggestSkills({ intent: 'add a database index to speed up the query', rootDir: ROOT, limit: 5 });
  assert.ok(!suggestions.some((s) => s.path === SKILL), 'an unrelated engineering intent must not surface the prioritization skill');
});

test('both templates point at the skill', () => {
  const backlog = fs.readFileSync(path.join(ROOT, 'templates/docs/backlog-proposal.md'), 'utf8');
  const prd = fs.readFileSync(path.join(ROOT, 'templates/docs/prd.md'), 'utf8');
  assert.match(backlog, /## Prioritization rationale/, 'backlog-proposal gains a Prioritization rationale section');
  assert.match(backlog, /strategy\/prioritization-methods/, 'backlog-proposal references the skill');
  assert.match(prd, /strategy\/prioritization-methods/, 'PRD Goals ordering references the skill');
});
