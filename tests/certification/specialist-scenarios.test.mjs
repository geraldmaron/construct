/**
 * tests/certification/specialist-scenarios.test.mjs — per-specialist scenario fixtures.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  validateSpecialistScenarioFixture,
  writeSpecialistScenarioFixtures,
} from '../../lib/certification/specialist-scenarios.mjs';
import { listScenarios } from '../../lib/certification/scenarios.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('writeSpecialistScenarioFixtures authors 58 scenarios (2 per specialist)', () => {
  const result = writeSpecialistScenarioFixtures({ rootDir: REPO });
  assert.equal(result.specialistCount, 29);
  assert.equal(result.catalogEntries, 58);
  const scenarios = listScenarios({ repoRoot: REPO });
  const normal = scenarios.filter((s) => s.id.startsWith('specialist.normal.'));
  const adversarial = scenarios.filter((s) => s.id.startsWith('specialist.adversarial.'));
  assert.equal(normal.length, 29);
  assert.equal(adversarial.length, 29);
});

test('every specialist scenario fixture validates', () => {
  writeSpecialistScenarioFixtures({ rootDir: REPO });
  const dir = path.join(REPO, 'tests', 'certification', 'scenarios', 'specialists');
  const specialists = fs.readdirSync(dir).filter((name) => name.startsWith('cx-'));
  assert.equal(specialists.length, 29);
  for (const specialistDir of specialists) {
    for (const file of ['normal.json', 'adversarial.json']) {
      const fixture = JSON.parse(fs.readFileSync(path.join(dir, specialistDir, file), 'utf8'));
      const result = validateSpecialistScenarioFixture(fixture, { rootDir: REPO });
      assert.equal(result.pass, true, `${specialistDir}/${file}: ${result.errors.join(', ')}`);
      assert.equal(fixture.capabilityId, 'specialist.prompt');
    }
  }
});

test('writeSpecialistScenarioFixtures is idempotent', () => {
  const first = writeSpecialistScenarioFixtures({ rootDir: REPO });
  const second = writeSpecialistScenarioFixtures({ rootDir: REPO });
  assert.equal(first.catalogEntries, second.catalogEntries);
});
