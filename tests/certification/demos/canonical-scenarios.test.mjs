/**
 * tests/certification/demos/canonical-scenarios.test.mjs — canonical demo scenario catalog validator.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  validateCanonicalScenarios,
  CANONICAL_DEMO_SCHEMA,
  loadCanonicalScenarios,
} from '../../../lib/certification/canonical-scenarios.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

const EXPECTED_DEMO_IDS = [
  'agentic-platforms-prd',
  'construct-cockpit',
  'architecture-review-adr',
  'capability-contract',
  'intake-triage',
  'profile-doctor-health',
];

test('canonical demo catalog validates committed fixture', () => {
  const result = validateCanonicalScenarios({ rootDir: REPO });
  assert.equal(result.pass, true, result.errors.join('; '));
  assert.ok(result.demoCount >= 6, `expected at least 6 demos, got ${result.demoCount}`);
});

test('canonical demos cite templates/demos tape paths', () => {
  const { catalog } = loadCanonicalScenarios({ repoRoot: REPO });
  assert.equal(catalog.schema, CANONICAL_DEMO_SCHEMA);
  const prd = catalog.demos.find((d) => d.id === 'agentic-platforms-prd');
  const cockpit = catalog.demos.find((d) => d.id === 'construct-cockpit');
  assert.ok(prd.tape.startsWith('templates/demos/tapes/'));
  assert.ok(cockpit.tape.startsWith('templates/demos/tapes/'));
  assert.equal(cockpit.vhsTheme, 'templates/demos/vhs/construct-cockpit.json');
});

test('catalog enumerates all six canonical demos with existing tapes', () => {
  const { catalog } = loadCanonicalScenarios({ rootDir: REPO });
  const ids = catalog.demos.map((d) => d.id);
  for (const id of EXPECTED_DEMO_IDS) {
    assert.ok(ids.includes(id), `catalog missing demo id: ${id}`);
    const demo = catalog.demos.find((d) => d.id === id);
    const tape = demo.tape ?? demo.tapePath;
    assert.ok(tape.startsWith('templates/demos/tapes/'), `${id}: tape must live under templates/demos/tapes/`);
    assert.ok(fs.existsSync(path.join(REPO, tape)), `${id}: cited tape does not exist: ${tape}`);
  }
});
