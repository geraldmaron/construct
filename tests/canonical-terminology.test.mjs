/**
 * canonical-terminology.test.mjs — Ratchets Construct's domain naming contract.
 *
 * The machine-readable map is the handoff between the architecture decision and
 * breaking registry, catalog, executable-surface, documentation, and generated-
 * adapter cutovers. These checks keep its concept boundary complete and prevent
 * canonical architecture pages from restoring the retired fixed-cast model.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAP_PATH = path.join(ROOT, 'config', 'canonical-terminology.json');

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
    assert.ok(concept.runtimeRoot || concept.dataRoot, `${id} must declare filesystem ownership`);
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
  assert.equal(map.currentToCanonical['specialists/org/worker-profiles/'], 'registry/workspace-presets/');
  assert.equal(map.currentToCanonical['specialists/org/specialists/'], 'registry/worker-profiles/');
});

test('canonical concept docs do not restore the fixed-cast organization model', () => {
  const files = [
    'docs/guides/concepts/architecture.mdx',
    'docs/guides/concepts/workspace-preset-lifecycle.md',
  ];
  const forbidden = [
    /team of specialists/i,
    /fixed (?:\d+-)?role roster/i,
    /specialist sequence/i,
    /persona is the only thing the user talks to/i,
    /specialists challenge each other/i,
    /invent(?:ing)? new roles or departments/i,
    /department-style model/i,
    /## specialist roster/i,
    /12-role roster/i,
  ];

  for (const rel of files) {
    const source = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    for (const pattern of forbidden) {
      assert.doesNotMatch(source, pattern, `${rel} restores retired domain model: ${pattern}`);
    }
  }
});
