/**
 * tests/certification/specialist-scenarios.test.mjs — per-specialist scenario fixtures.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  validateSpecialistScenarioFixture,
  writeSpecialistScenarioFixtures,
} from '../../lib/certification/specialist-scenarios.mjs';
import { listScenarios } from '../../lib/certification/scenarios.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// Writing the scenario catalog then reading it back via listScenarios races
// other certification test files mutating the same catalog when pointed at the
// live repo — the "58" count drifted intermittently. An isolated tmp seeded with
// the registry, catalog, and role cards keeps the write/read deterministic and
// the repo clean.

test('writeSpecialistScenarioFixtures authors 58 scenarios (2 per specialist)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'specialist-scenarios-'));
  try {
    fs.mkdirSync(path.join(tmp, 'specialists'), { recursive: true });
    fs.copyFileSync(
      path.join(REPO, 'specialists', 'unified-registry.json'),
      path.join(tmp, 'specialists', 'unified-registry.json'),
    );
    fs.mkdirSync(path.join(tmp, 'tests', 'certification', 'scenarios'), { recursive: true });
    fs.copyFileSync(
      path.join(REPO, 'tests', 'certification', 'scenarios', 'catalog.json'),
      path.join(tmp, 'tests', 'certification', 'scenarios', 'catalog.json'),
    );
    // Role cards gate which specialists get scenarios (the writer skips any
    // specialist without one), so the tmp needs them to reach the full 29.
    fs.cpSync(
      path.join(REPO, 'tests', 'certification', 'specialists'),
      path.join(tmp, 'tests', 'certification', 'specialists'),
      { recursive: true },
    );

    const result = writeSpecialistScenarioFixtures({ rootDir: tmp });
    assert.equal(result.specialistCount, 29);
    assert.equal(result.catalogEntries, 58);
    const scenarios = listScenarios({ repoRoot: tmp });
    const normal = scenarios.filter((s) => s.id.startsWith('specialist.normal.'));
    const adversarial = scenarios.filter((s) => s.id.startsWith('specialist.adversarial.'));
    assert.equal(normal.length, 29);
    assert.equal(adversarial.length, 29);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
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
