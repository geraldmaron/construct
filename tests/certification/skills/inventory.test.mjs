/**
 * tests/certification/skills/inventory.test.mjs — skill inventory audit and freshness.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildSkillInventory,
  validateSkillInventory,
  defaultSkillInventoryPath,
} from '../../../lib/certification/skill-inventory.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

test('skill inventory includes every skills/** file', () => {
  const inventory = buildSkillInventory({ rootDir: REPO });
  assert.ok(inventory.skillCount > 100);
  assert.equal(inventory.skills.length, inventory.skillCount);
  for (const skill of inventory.skills) {
    assert.ok(skill.id);
    assert.ok(Array.isArray(skill.owners));
    assert.ok(Array.isArray(skill.activationTriggers));
    assert.ok(Array.isArray(skill.inputs));
    assert.ok(skill.outputs);
    assert.ok(Array.isArray(skill.verificationHooks));
  }
});

test('committed skill inventory is fresh', () => {
  const result = validateSkillInventory({ rootDir: REPO, checkFreshness: true });
  assert.equal(result.pass, true, result.errors.join('; '));
  assert.equal(result.filePath, defaultSkillInventoryPath(REPO));
});

test('skill inventory records blocking findings without failing freshness', () => {
  const inventory = buildSkillInventory({ rootDir: REPO });
  const noOwner = inventory.blockingFindings.filter((f) => f.kind === 'no-owner');
  const conflicts = inventory.blockingFindings.filter((f) => f.kind === 'conflicting-output-contract');
  assert.ok(Array.isArray(noOwner));
  assert.ok(Array.isArray(conflicts));
  if (conflicts.length) {
    assert.ok(conflicts.some((c) => c.artifactType === 'prd'));
  }
});
