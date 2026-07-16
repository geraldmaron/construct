/**
 * tests/oracle-invariants-config-schema-has-no-shadowed-properties.test.mjs — the
 * `config-schema-has-no-shadowed-properties` Layer 1 invariant: compareNode's
 * enum/presence/default comparison logic, and check() against a real hermetic
 * fixture schema file.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { id, layer, compareNode, check } from '../lib/oracle/invariants/config-schema-has-no-shadowed-properties.mjs';

test('invariant module exports id/layer per the registry contract', () => {
  assert.equal(id, 'config-schema-has-no-shadowed-properties');
  assert.equal(layer, 1);
});

test('compareNode: a property present in both sources with matching enum passes', () => {
  const results = [];
  compareNode({ type: 'string', enum: ['a', 'b'] }, { type: 'string', enum: ['a', 'b'] }, 'mode', results);
  assert.equal(results.length, 1);
  assert.equal(results[0].status, 'passed');
});

test('compareNode: a FIELD_RULES enum value absent from the JSON schema enum is a violation', () => {
  const results = [];
  compareNode({ type: 'string', enum: ['a', 'b', 'c'] }, { type: 'string', enum: ['a', 'b'] }, 'mode', results);
  const violation = results.find((r) => r.status === 'failed');
  assert.ok(violation);
  assert.match(violation.detail, /enum mismatch/);
  assert.match(violation.detail, /"c"/);
});

test('compareNode: a FIELD_RULES property entirely absent from the JSON schema is a violation', () => {
  const results = [];
  compareNode({ type: 'object', fields: { x: { type: 'string' } } }, undefined, 'costs', results);
  const violation = results.find((r) => r.path === 'costs' && r.status === 'failed');
  assert.ok(violation);
  assert.match(violation.detail, /absent from schemas\/project-config\.schema\.json/);
});

test('compareNode: recurses into nested `fields` and flags a nested absence independently', () => {
  const results = [];
  compareNode(
    { type: 'object', fields: { outputMode: { type: 'string', enum: ['auto', 'silent'] } } },
    undefined,
    'hooks',
    results,
  );
  assert.ok(results.find((r) => r.path === 'hooks' && r.status === 'failed'));
  assert.ok(results.find((r) => r.path === 'hooks.outputMode' && r.status === 'failed'));
});

test('compareNode: a JSON schema default that disagrees with DEFAULT_PROJECT_CONFIG is a violation', () => {
  const results = [];
  compareNode({ type: 'string', enum: ['tier_defaults', 'all_configured'] }, { type: 'string', default: 'all_configured' }, 'models.visibility.mode', results);
  const defaultResult = results.find((r) => r.path === 'models.visibility.mode#default');
  assert.ok(defaultResult);
  assert.equal(defaultResult.status, 'failed');
  assert.match(defaultResult.detail, /tier_defaults/);
});

function fixtureSchema(overrides) {
  return {
    type: 'object',
    properties: {
      version: { type: 'number', default: 1 },
      alias: { type: 'string' },
      scope: { type: 'string', enum: ['rnd', 'operations', 'creative', 'research'] },
      ...overrides,
    },
  };
}

test('check(): a schema fixture that fully matches the real FIELD_RULES top-level shape it covers reports no violations for those keys', async (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-invariant-config-schema-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const schemaPath = path.join(cwd, 'project-config.schema.json');
  fs.writeFileSync(schemaPath, JSON.stringify(fixtureSchema({})));

  const result = await check({ schemaPath });
  const scopeResult = result.results.find((r) => r.path === 'scope');
  assert.equal(scopeResult.status, 'passed');
});

test('check(): the real repo schema/FIELD_RULES pair has a known, cited drift (rolls up to failed)', async () => {
  const result = await check({});
  assert.equal(result.status, 'failed');
  assert.ok(result.violations.some((v) => v.path === 'orchestration.workerBackend'));
  assert.ok(result.violations.some((v) => v.path === 'ingest.strategy'));
  assert.ok(result.violations.some((v) => v.path === 'costs'));
  assert.ok(result.violations.some((v) => v.path === 'hooks'));
});

test('check(): an unreadable schema path degrades to collection-error, not a crash', async () => {
  const result = await check({ schemaPath: '/nonexistent/schema/path/for/this/test.json' });
  assert.equal(result.status, 'collection-error');
});
