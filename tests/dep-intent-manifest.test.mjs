/**
 * tests/dep-intent-manifest.test.mjs — Dependency-intent manifest integrity gate.
 *
 * Verifies:
 *   1. Every dep in package.json has an entry in deps/intent.json
 *   2. Every quarantined dep has a removalCriteria string
 *   3. All dispositions are valid enum values
 *
 * @enforces ADR-0059 (dependency-intent rubric)
 * @bead construct-9oi4.11.1
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PKG_PATH = resolve(ROOT, 'package.json');
const INTENT_PATH = resolve(ROOT, 'deps', 'intent.json');

const VALID_DISPOSITIONS = new Set([
  'core',
  'optional',
  'provider-plugin',
  'dev',
  'replace',
  'remove',
  'quarantine',
]);

function loadJSON(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

const pkg = loadJSON(PKG_PATH);
const intentEntries = loadJSON(INTENT_PATH);

const pkgDeps = new Set([
  ...Object.keys(pkg.dependencies ?? {}),
  ...Object.keys(pkg.optionalDependencies ?? {}),
  ...Object.keys(pkg.devDependencies ?? {}),
]);

const intentMap = new Map(intentEntries.map((entry) => [entry.id, entry]));

test('deps/intent.json exists and is a non-empty array', () => {
  assert.ok(Array.isArray(intentEntries), 'deps/intent.json must be a JSON array');
  assert.ok(intentEntries.length > 0, 'deps/intent.json must have at least one entry');
});

test('every dep in package.json has an entry in deps/intent.json', () => {
  const missing = [];
  for (const dep of pkgDeps) {
    if (!intentMap.has(dep)) {
      missing.push(dep);
    }
  }
  assert.deepEqual(
    missing,
    [],
    `Missing intent entries for: ${missing.join(', ')} — add entries to deps/intent.json per ADR-0059`,
  );
});

test('every quarantined dep has a non-empty removalCriteria', () => {
  const violations = [];
  for (const entry of intentEntries) {
    if (entry.disposition === 'quarantine') {
      if (
        !entry.removalCriteria ||
        typeof entry.removalCriteria !== 'string' ||
        entry.removalCriteria.trim() === '' ||
        entry.removalCriteria === 'null'
      ) {
        violations.push(entry.id);
      }
    }
  }
  assert.deepEqual(
    violations,
    [],
    `Quarantined deps missing removalCriteria: ${violations.join(', ')} — all quarantined deps must have a removal plan`,
  );
});

test('all intent entries have valid disposition values', () => {
  const invalid = [];
  for (const entry of intentEntries) {
    if (!VALID_DISPOSITIONS.has(entry.disposition)) {
      invalid.push(`${entry.id}: '${entry.disposition}'`);
    }
  }
  assert.deepEqual(
    invalid,
    [],
    `Invalid dispositions: ${invalid.join(', ')} — must be one of: ${[...VALID_DISPOSITIONS].join(', ')}`,
  );
});

test('no dep has disposition=remove while still present in package.json', () => {
  const violations = [];
  for (const entry of intentEntries) {
    if (entry.disposition === 'remove' && pkgDeps.has(entry.id)) {
      violations.push(entry.id);
    }
  }
  assert.deepEqual(
    violations,
    [],
    `Deps marked for removal still in package.json: ${violations.join(', ')} — remove from package.json or update disposition`,
  );
});

test('every intent entry has all required fields', () => {
  const requiredFields = [
    'id',
    'kind',
    'purpose',
    'owningWorkflow',
    'modeRequirement',
    'healthCheck',
    'degradationBehavior',
    'securityConcerns',
    'removalCriteria',
    'disposition',
  ];
  const violations = [];
  for (const entry of intentEntries) {
    for (const field of requiredFields) {
      if (!(field in entry) || entry[field] === undefined) {
        violations.push(`${entry.id}: missing field '${field}'`);
      }
    }
  }
  assert.deepEqual(
    violations,
    [],
    `Intent entries missing required fields: ${violations.join('; ')}`,
  );
});

test('intent entry count is reported', () => {
  // Informational — always passes; provides visibility in test output
  const count = intentEntries.length;
  const pkgCount = pkgDeps.size;
  assert.ok(count >= pkgCount, `Intent entry count (${count}) must be >= package.json dep count (${pkgCount})`);
});
