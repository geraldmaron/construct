/**
 * canonical-terminology.test.mjs — Ratchets Construct's domain naming contract.
 *
 * The machine-readable map is the handoff between the architecture decision and
 * breaking registry, catalog, executable-surface, documentation, and generated-
 * adapter cutovers. These checks keep its concept boundary complete.
 * Planned/interim concepts must not advertise missing store paths as live APIs.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAP_PATH = path.join(ROOT, 'config', 'canonical-terminology.json');

const PLANNED_STORE_IDS = ['objective', 'work'];
const INTERIM_STORE_IDS = ['work-specification', 'plan'];

test('canonical terminology map has distinct concepts and owned roots', () => {
  const map = JSON.parse(fs.readFileSync(MAP_PATH, 'utf8'));
  const expected = [
    'workspace',
    'workspace-preset',
    'source',
    'objective',
    'directive',
    'work',
    'work-specification',
    'plan',
    'run',
    'worker-profile',
    'skill',
    'procedure',
    'assignment',
    'capability',
    'policy',
    'artifact',
    'evidence',
    'projection',
    'graph-node',
    'graph-edge',
  ];

  assert.deepEqual(Object.keys(map.concepts), expected);
  const requiredFields = [
    'label',
    'pluralLabel',
    'identifier',
    'meaning',
    'sourceOfTruth',
    'owningModule',
    'configField',
    'cliNoun',
    'mcpNoun',
    'graphNode',
  ];
  for (const [id, concept] of Object.entries(map.concepts)) {
    const status = concept.implementationStatus || 'shipped';
    if (status === 'shipped' || status === 'interim') {
      assert.ok(concept.runtimeRoot || concept.dataRoot, `${id} must declare filesystem ownership when ${status}`);
    }
    if (status === 'planned' || status === 'interim') {
      assert.equal(typeof concept.targetOwningModule, 'string', `${id} must declare targetOwningModule when ${status}`);
      assert.ok(concept.targetOwningModule.length > 0, `${id}.targetOwningModule must not be empty`);
      assert.equal(typeof concept.interimMap, 'string', `${id} must declare interimMap when ${status}`);
      assert.ok(concept.interimMap.length > 0, `${id}.interimMap must not be empty`);
    }
    for (const field of requiredFields) {
      assert.equal(typeof concept[field], 'string', `${id}.${field} must be a string`);
      assert.ok(concept[field].length > 0, `${id}.${field} must not be empty`);
    }
  }
  assert.deepEqual(Object.keys(map.termClassifications), [
    'persona',
    'role',
    'specialist',
    'team',
    'group',
    'scope',
    'workflow',
    'contract',
    'org',
    'cx-',
    'legacy',
    'deprecated',
    'version-qualified-product-name',
  ]);
  assert.notEqual(map.termClassifications.scope.replacement, map.termClassifications.specialist.replacement);
  assert.equal(map.termClassifications.scope.replacement, 'workspace-preset');
  assert.equal(map.termClassifications.specialist.replacement, 'worker-profile');
  assert.deepEqual(map.cutoverOrder, Object.keys(map.consumerInventory));
  assert.deepEqual(map.consumerInventory['catalog-and-loaders'], [
    'registry/', 'lib/workspace-presets/', 'lib/worker-profiles/', 'lib/skills/',
  ]);
  assert.deepEqual(map.obsoleteSurfaces.roots, ['specialists/', 'personas/', '.cx/']);
});

test('Objective/Work/Plan store paths are not advertised as live modules', () => {
  const map = JSON.parse(fs.readFileSync(MAP_PATH, 'utf8'));

  for (const id of PLANNED_STORE_IDS) {
    const concept = map.concepts[id];
    assert.equal(concept.implementationStatus, 'planned', `${id} must be planned`);
    assert.equal(concept.owningModule, 'none (planned)');
    assert.equal(concept.runtimeRoot, undefined, `${id} must not claim a runtimeRoot`);
    assert.equal(concept.dataRoot, undefined, `${id} must not claim a dataRoot`);
    assert.match(concept.cliNoun, /none \(planned\)/);
    assert.match(concept.mcpNoun, /none \(planned\)/);
    const target = concept.targetOwningModule.replace(/\/$/, '');
    assert.equal(fs.existsSync(path.join(ROOT, target)), false, `${target} must not exist on disk yet`);
  }

  for (const id of INTERIM_STORE_IDS) {
    const concept = map.concepts[id];
    assert.equal(concept.implementationStatus, 'interim', `${id} must be interim`);
    assert.equal(concept.owningModule, 'lib/planning/');
    assert.equal(concept.runtimeRoot, 'lib/planning/');
    assert.equal(concept.dataRoot, undefined, `${id} must not claim a missing target dataRoot as live`);
    assert.ok(fs.existsSync(path.join(ROOT, 'lib', 'planning')), 'interim owner lib/planning/ must exist');
    const target = concept.targetOwningModule.replace(/\/$/, '');
    assert.equal(fs.existsSync(path.join(ROOT, target)), false, `${target} must remain a catalog target only`);
  }

  assert.match(map.currentToCanonical['lib/objectives/'], /planned/);
  assert.match(map.currentToCanonical['lib/work/'], /planned/);
  assert.match(map.currentToCanonical['lib/plans/'], /interim/);
  assert.match(map.currentToCanonical['lib/work-specifications/'], /interim/);
});
