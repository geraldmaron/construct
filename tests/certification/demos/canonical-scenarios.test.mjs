/**
 * tests/certification/demos/canonical-scenarios.test.mjs — canonical demo scenario catalog validator.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  validateCanonicalScenarios,
  CANONICAL_DEMO_SCHEMA,
  loadCanonicalScenarios,
} from '../../../lib/certification/canonical-scenarios.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

test('canonical demo catalog validates committed fixture', () => {
  const result = validateCanonicalScenarios({ rootDir: REPO });
  assert.equal(result.pass, true, result.errors.join('; '));
  assert.ok(result.demoCount >= 2);
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
