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
import { writeRoleCards } from '../../lib/certification/role-cards.mjs';
import { listScenarios } from '../../lib/certification/scenarios.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// The "58" count must not read any file another certification test rewrites
// mid-suite: role-cards.test.mjs rewrites the live role cards and several tests
// rewrite the live catalog, so copying either into the tmp raced their writes and
// the count drifted. Seed the tmp from the registry alone — the one input never
// written live — then generate the role cards and an empty catalog in place. The
// returned counts and the listScenarios prefix totals are independent of any
// pre-existing catalog content, so the assertions are unchanged.

test('writeSpecialistScenarioFixtures authors 58 scenarios (2 per specialist)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'specialist-scenarios-'));
  try {
    fs.mkdirSync(path.join(tmp, 'specialists'), { recursive: true });
    fs.cpSync(
      path.join(REPO, 'specialists', 'org'),
      path.join(tmp, 'specialists', 'org'),
      { recursive: true },
    );
    fs.mkdirSync(path.join(tmp, 'tests', 'certification', 'scenarios'), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, 'tests', 'certification', 'scenarios', 'catalog.json'),
      `${JSON.stringify({ scenarios: [] }, null, 2)}\n`,
    );
    // Role cards gate which specialists get scenarios (the writer skips any
    // without one); generating them in the tmp from the copied registry yields one
    // per specialist without reading the live cards role-cards.test.mjs rewrites.
    writeRoleCards({ rootDir: tmp });

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
