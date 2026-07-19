/**
 * tests/mcp/get-skill-entitlement.test.mjs — get_skill's workerProfileId entitlement path.
 *
 * The denial path in lib/mcp/tools/skills.mjs's getSkill has always required a
 * workerProfileId argument is part of the public MCP schema. Entitled reads pass
 * silently, non-entitled reads carry a warning by default and fail outright
 * under CONSTRUCT_STRICT_SKILLS=1.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { getSkill } from '../../lib/mcp/tools/skills.mjs';
import { TOOL_DEFS_SKILLS } from '../../lib/mcp/tool-definitions-skills.mjs';

const ROOT_DIR = new URL('../..', import.meta.url).pathname;

// reviewer's real, non-empty entitlement list (specialists/org/specialists/reviewer.json)
// does not include docs/prd-workflow — a genuine negative fixture, not a synthetic one.
const ENTITLED_PATH = 'quality-gates/verify-quality';
const NOT_ENTITLED_PATH = 'docs/prd-workflow';

test('get_skill inputSchema declares only the canonical workerProfileId', () => {
  const def = TOOL_DEFS_SKILLS.find((d) => d.name === 'get_skill');
  assert.ok(def, 'get_skill tool def must exist');
  assert.ok('workerProfileId' in def.inputSchema.properties, 'workerProfileId must be a public parameter');
  assert.equal('specialistId' in def.inputSchema.properties, false);
  assert.equal('agentId' in def.inputSchema.properties, false);
});

test('an entitled worker profile reads its own skill with no warning', () => {
  const result = getSkill({ path: ENTITLED_PATH, workerProfileId: 'reviewer' }, { ROOT_DIR });
  assert.ok(result.content, JSON.stringify(result));
  assert.equal(result.warning, undefined);
});

test('a non-entitled worker profile gets an annotation warning by default, content still returned', () => {
  const result = getSkill({ path: NOT_ENTITLED_PATH, workerProfileId: 'reviewer' }, { ROOT_DIR });
  assert.ok(result.content, JSON.stringify(result));
  assert.match(result.warning, /not in worker profile reviewer's entitlement list/);
});

test('a non-entitled worker profile is denied under CONSTRUCT_STRICT_SKILLS=1', () => {
  const prev = process.env.CONSTRUCT_STRICT_SKILLS;
  process.env.CONSTRUCT_STRICT_SKILLS = '1';
  try {
    const result = getSkill({ path: NOT_ENTITLED_PATH, workerProfileId: 'reviewer' }, { ROOT_DIR });
    assert.equal(result.content, undefined);
    assert.match(result.error, /not in worker profile reviewer's entitlement list/);
  } finally {
    if (prev === undefined) delete process.env.CONSTRUCT_STRICT_SKILLS;
    else process.env.CONSTRUCT_STRICT_SKILLS = prev;
  }
});

test('no workerProfileId means no entitlement check at all', () => {
  const result = getSkill({ path: NOT_ENTITLED_PATH }, { ROOT_DIR });
  assert.ok(result.content, JSON.stringify(result));
  assert.equal(result.warning, undefined);
});
