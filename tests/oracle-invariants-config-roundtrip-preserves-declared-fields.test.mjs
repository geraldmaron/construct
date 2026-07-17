/**
 * tests/oracle-invariants-config-roundtrip-preserves-declared-fields.test.mjs — the
 * `config-roundtrip-preserves-declared-fields` Layer 1 invariant: representative-value
 * generation, the leaf-collection/object-marker classification, the pure roundtrip
 * comparison, and check() against a real writeProjectConfig()/loadProjectConfig()
 * roundtrip in a hermetic tmpdir.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { FIELD_RULES, CONFIG_SCHEMA_VERSION } from '../lib/config/schema.mjs';
import {
  id,
  layer,
  representativeValue,
  buildRepresentativeConfig,
  collectLeaves,
  compareRoundtrip,
  check,
} from '../lib/oracle/invariants/config-roundtrip-preserves-declared-fields.mjs';

test('invariant module exports id/layer per the registry contract', () => {
  assert.equal(id, 'config-roundtrip-preserves-declared-fields');
  assert.equal(layer, 1);
});

test('representativeValue: the version field always gets CONFIG_SCHEMA_VERSION, never a probe number', () => {
  const counter = { n: 0 };
  assert.equal(representativeValue(FIELD_RULES.version, 'version', counter), CONFIG_SCHEMA_VERSION);
});

test('representativeValue: an enum field gets its first enum value', () => {
  const counter = { n: 0 };
  assert.equal(representativeValue({ type: 'string', enum: ['solo', 'team'] }, 'deployment.mode', counter), 'solo');
});

test('representativeValue: an object field with no declared .fields gets a marker-tagged probe object', () => {
  const counter = { n: 0 };
  const value = representativeValue({ type: 'object' }, 'resources', counter);
  assert.equal(value.__invariantProbe, 'resources-probe');
});

test('buildRepresentativeConfig covers every top-level FIELD_RULES key', () => {
  const config = buildRepresentativeConfig();
  for (const key of Object.keys(FIELD_RULES)) {
    assert.ok(key in config, `${key} missing from the representative config`);
  }
});

test('collectLeaves tags an object-typed leaf with no nested .fields as isObjectMarker', () => {
  const leaves = collectLeaves({ resources: { type: 'object', required: false } });
  assert.deepEqual(leaves, [{ path: 'resources', isObjectMarker: true }]);
});

test('collectLeaves does not tag an enum-typed field as an object marker even if type were object-shaped', () => {
  const leaves = collectLeaves({ scope: { type: 'string', enum: ['rnd'] } });
  assert.equal(leaves[0].isObjectMarker, false);
});

test('compareRoundtrip: a scalar field that changed across the roundtrip is a violation', () => {
  const fieldRules = { alias: { type: 'string' } };
  const results = compareRoundtrip({ alias: 'original' }, { alias: 'mutated' }, fieldRules);
  assert.equal(results[0].status, 'failed');
  assert.equal(results[0].violation, true);
});

test('compareRoundtrip: an object-marker field survives even when deepMerge unions extra default sub-keys around it', () => {
  const fieldRules = { resources: { type: 'object' } };
  const original = { resources: { __invariantProbe: 'resources-probe' } };
  const roundtripped = { resources: { disk: { totalCxMaxMb: 2000 }, __invariantProbe: 'resources-probe' } };
  const results = compareRoundtrip(original, roundtripped, fieldRules);
  assert.equal(results[0].status, 'passed', 'extra default keys unioned in by deepMerge must not read as a violation');
});

test('compareRoundtrip: an object-marker field whose probe value was actually dropped is a violation', () => {
  const fieldRules = { resources: { type: 'object' } };
  const original = { resources: { __invariantProbe: 'resources-probe' } };
  const roundtripped = { resources: { disk: { totalCxMaxMb: 2000 } } };
  const results = compareRoundtrip(original, roundtripped, fieldRules);
  assert.equal(results[0].status, 'failed');
});

test('check(): the real project-config write/load path preserves every FIELD_RULES-declared field', async () => {
  const result = await check({});
  assert.equal(result.status, 'passed');
  assert.ok(result.evaluated > 0);
  assert.equal(result.violations.length, 0);
});

test('check(): writeProjectConfig() rejecting the representative config degrades to collection-error, not a crash', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-invariant-config-roundtrip-badwrite-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'construct.config.json'));

  const result = await check({ tmpDirFactory: () => dir });
  assert.equal(result.status, 'collection-error');
});
