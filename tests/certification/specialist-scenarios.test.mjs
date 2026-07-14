/**
 * tests/certification/specialist-scenarios.test.mjs — per-specialist scenario fixtures (schema v2).
 *
 * v2 fixtures are authored on disk (role-specific representativeTask + expectedBehavior),
 * not generated from the role card. These tests pin: every authored fixture validates,
 * no liveScoring field survives anywhere, the base-chain four carry all five scenario
 * kinds, adversarial prompts are role-specific and unique (the core H2 regression), and
 * the catalog sync registers one hermetic entry per fixture without clobbering the
 * role-card/contract entries.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  SPECIALIST_SCENARIO_KINDS,
  validateSpecialistScenarioFixture,
  validateAdversarialDiversity,
  readSpecialistScenarioFixtures,
  syncSpecialistScenarioCatalog,
} from '../../lib/certification/specialist-scenarios.mjs';
import { writeRoleCards } from '../../lib/certification/role-cards.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BASE_CHAIN = ['cx-architect', 'cx-engineer', 'cx-reviewer', 'cx-qa'];

test('every authored specialist fixture validates against schema v2', () => {
  const fixtures = readSpecialistScenarioFixtures({ rootDir: REPO });
  assert.equal(fixtures.length, 36, 'expected 36 fixtures (12x2 + 4 base-chain x 3 extra kinds)');
  for (const { relPath, fixture } of fixtures) {
    const result = validateSpecialistScenarioFixture(fixture, { rootDir: REPO });
    assert.equal(result.pass, true, `${relPath}: ${result.errors.join(', ')}`);
    assert.equal(fixture.schemaVersion, 2, `${relPath} must be schema v2`);
    assert.equal('liveScoring' in fixture, false, `${relPath} must not carry a liveScoring field`);
    assert.equal(fixture.capabilityId, 'specialist.prompt');
  }
});

test('the base-chain four carry all five scenario kinds; every other specialist carries the core two', () => {
  const fixtures = readSpecialistScenarioFixtures({ rootDir: REPO });
  const bySpecialist = new Map();
  for (const { specialistId, fixture } of fixtures) {
    if (!bySpecialist.has(specialistId)) bySpecialist.set(specialistId, new Set());
    bySpecialist.get(specialistId).add(fixture.scenarioKind);
  }
  assert.equal(bySpecialist.size, 12, 'all 12 specialists have fixtures');
  for (const [specialistId, kinds] of bySpecialist) {
    assert.ok(kinds.has('happy-path-representative'), `${specialistId} has a representative fixture`);
    assert.ok(kinds.has('adversarial-role-tailored'), `${specialistId} has an adversarial fixture`);
    if (BASE_CHAIN.includes(specialistId)) {
      for (const kind of SPECIALIST_SCENARIO_KINDS) {
        assert.ok(kinds.has(kind), `${specialistId} (base chain) has a ${kind} fixture`);
      }
    }
  }
});

test('adversarial prompts are role-specific and unique — no byte-identical reuse', () => {
  const { pass, collisions, count } = validateAdversarialDiversity({ rootDir: REPO });
  assert.equal(pass, true, `adversarial prompt collisions: ${collisions.join('; ')}`);
  assert.ok(count >= 12, 'at least one adversarial fixture per specialist');
});

test('syncSpecialistScenarioCatalog registers one hermetic entry per fixture and preserves other specialist entries', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'specialist-scenarios-v2-'));
  try {
    fs.mkdirSync(path.join(tmp, 'specialists'), { recursive: true });
    fs.cpSync(path.join(REPO, 'specialists', 'org'), path.join(tmp, 'specialists', 'org'), { recursive: true });
    fs.cpSync(
      path.join(REPO, 'tests', 'certification', 'scenarios', 'specialists'),
      path.join(tmp, 'tests', 'certification', 'scenarios', 'specialists'),
      { recursive: true },
    );
    writeRoleCards({ rootDir: tmp });
    // Seed a non-specialist-scenario entry the sync must preserve, and a stale v1
    // entry it must drop.
    fs.writeFileSync(
      path.join(tmp, 'tests', 'certification', 'scenarios', 'catalog.json'),
      `${JSON.stringify({ scenarios: [
        { id: 'specialist.role-cards', capabilityId: 'specialist.prompt', mode: 'hermetic' },
        { id: 'specialist.normal.architect', capabilityId: 'specialist.prompt', mode: 'hermetic' },
      ] }, null, 2)}\n`,
    );

    const result = syncSpecialistScenarioCatalog({ rootDir: tmp });
    assert.equal(result.fixtureCount, 36);
    assert.equal(result.catalogEntries, 36);

    const catalog = JSON.parse(fs.readFileSync(path.join(tmp, 'tests', 'certification', 'scenarios', 'catalog.json'), 'utf8'));
    const ids = new Set(catalog.scenarios.map((s) => s.id));
    assert.ok(ids.has('specialist.role-cards'), 'role-cards entry preserved');
    assert.ok(!ids.has('specialist.normal.architect'), 'stale v1 entry dropped');
    assert.ok(ids.has('specialist.representative.architect'), 'v2 representative entry registered');
    assert.ok(ids.has('specialist.adversarial.qa'), 'v2 adversarial entry registered');
    for (const entry of catalog.scenarios.filter((s) => /^specialist\.(representative|adversarial|ambiguous|boundary|cross)\./.test(s.id))) {
      assert.equal(entry.gates[0].type, 'specialist-scenario-audit');
      assert.equal(entry.mode, 'hermetic');
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
