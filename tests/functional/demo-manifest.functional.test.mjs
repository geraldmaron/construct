/**
 * tests/functional/demo-manifest.functional.test.mjs — canonical Demo Manifest schema + loader.
 *
 * @capability demo.terminal-fallback
 *
 * Contract: schemas/demo-manifest.schema.json + lib/demo-manifest.mjs is the
 * single reconciling entry point for a demo definition. Covers: a well-formed
 * Manifest validates; one missing a required field fails naming the field;
 * the loader resolves a demo discoverable via lib/demo-recording.mjs's
 * existing search dirs (backward-compatible discovery); the graph-write
 * helper produces a node whose type is in lib/graph/store.mjs's NODE_TYPES.
 * Hermetic: an isolated tmpdir sandbox, no CLI spawn needed (library-level).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  DEMO_MANIFEST_SCHEMA,
  DEMO_MANIFEST_STATUSES,
  validateDemoManifest,
  loadDemoManifest,
  demoManifestGraphNode,
} from '../../lib/demo-manifest.mjs';
import { NODE_TYPES } from '../../lib/graph/store.mjs';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const SCHEMA_PATH = path.resolve(import.meta.dirname, '..', '..', 'schemas', 'demo-manifest.schema.json');

// A dependency-free conformance check driven by the real schema file: Construct
// keeps no ajv at startup, so the test enforces the schema's own
// required/const/pattern/enum/additionalProperties rules, mirroring
// tests/functional/demo-plugin.functional.test.mjs's pattern for
// schemas/project-demo.schema.json.

function validateAgainstSchema(schema, value) {
  const errors = [];
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return ['value is not an object'];

  for (const key of schema.required ?? []) {
    if (!(key in value)) errors.push(`missing required: ${key}`);
  }
  if (schema.additionalProperties === false) {
    const allowed = new Set(Object.keys(schema.properties ?? {}));
    for (const key of Object.keys(value)) {
      if (!allowed.has(key)) errors.push(`unexpected property: ${key}`);
    }
  }
  for (const [key, spec] of Object.entries(schema.properties ?? {})) {
    if (!(key in value)) continue;
    const v = value[key];
    if (spec.type === 'string' && typeof v !== 'string') errors.push(`${key} must be a string`);
    if (spec.const !== undefined && v !== spec.const) errors.push(`${key} must equal ${spec.const}`);
    if (spec.enum && !spec.enum.includes(v)) errors.push(`${key} must be one of ${spec.enum.join(', ')}`);
    if (spec.pattern && typeof v === 'string' && !new RegExp(spec.pattern).test(v)) errors.push(`${key} fails pattern ${spec.pattern}`);
  }
  return errors;
}

function wellFormedManifest() {
  return {
    schema: DEMO_MANIFEST_SCHEMA,
    name: 'tour',
    title: 'Guided tour',
    summary: 'Walks the read-only status and capability surfaces.',
    status: 'declared',
    script: '.construct/demos/scripts/tour.json',
    tape: '.construct/demos/tapes/tour.tape',
    fallbackSurface: 'tape',
    commands: ['node bin/construct status'],
  };
}

test('schemas/demo-manifest.schema.json is well-formed draft-07', () => {
  const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  assert.equal(schema.$schema, 'http://json-schema.org/draft-07/schema#');
  assert.equal(schema.properties.schema.const, DEMO_MANIFEST_SCHEMA);
  assert.deepEqual(schema.properties.status.enum, DEMO_MANIFEST_STATUSES);
});

test('a well-formed Demo Manifest validates against the schema and the hand-rolled validator', () => {
  const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  const manifest = wellFormedManifest();

  const schemaErrors = validateAgainstSchema(schema, manifest);
  assert.deepEqual(schemaErrors, [], `schema errors: ${schemaErrors.join('; ')}`);

  const handRolled = validateDemoManifest(manifest);
  assert.equal(handRolled.valid, true, `validator errors: ${handRolled.errors.join('; ')}`);
});

test('a Demo Manifest missing a required field fails validation naming that field', () => {
  const missingTitle = wellFormedManifest();
  delete missingTitle.title;

  const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  const schemaErrors = validateAgainstSchema(schema, missingTitle);
  assert.ok(schemaErrors.some((e) => e.includes('title')), `expected a title error, got: ${schemaErrors.join('; ')}`);

  const handRolled = validateDemoManifest(missingTitle);
  assert.equal(handRolled.valid, false);
  assert.ok(handRolled.errors.some((e) => e.includes('title')), `expected a title error, got: ${handRolled.errors.join('; ')}`);
});

test('an invalid status is rejected naming the field', () => {
  const manifest = wellFormedManifest();
  manifest.status = 'not-a-real-status';
  const handRolled = validateDemoManifest(manifest);
  assert.equal(handRolled.valid, false);
  assert.ok(handRolled.errors.some((e) => e.includes('status')), `expected a status error, got: ${handRolled.errors.join('; ')}`);
});

test('the reconciling loader resolves a demo discoverable via lib/demo-recording.mjs\'s existing search dirs', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-manifest-fn-'));
  try {
    const specRel = '.construct/demos/specs/tour.spec.ts';
    fs.mkdirSync(path.dirname(path.join(dir, specRel)), { recursive: true });
    fs.writeFileSync(path.join(dir, specRel), 'export {};\n', 'utf8');

    const recDir = path.join(dir, '.construct', 'demos', 'recordings');
    fs.mkdirSync(recDir, { recursive: true });
    fs.writeFileSync(path.join(recDir, 'tour.json'), JSON.stringify({
      name: 'tour',
      title: 'Guided tour (legacy recording)',
      engine: 'playwright',
      workspace: '.',
      spec: specRel,
      baseUrl: 'http://127.0.0.1:3456',
      skipWebServer: true,
      output: { format: 'mp4', path: '.construct/demos/tour.mp4' },
    }, null, 2), 'utf8');

    const loaded = loadDemoManifest('tour', { cwd: dir, repoRoot: dir });
    assert.equal(loaded.ok, true, `expected the legacy recording to resolve: ${loaded.errors?.join('; ')}`);
    assert.equal(loaded.manifest.schema, DEMO_MANIFEST_SCHEMA);
    assert.equal(loaded.manifest.name, 'tour');
    assert.equal(loaded.manifest.reconciledFrom, 'demo-recording-legacy');
    assert.equal(loaded.manifest.recording.spec, specRel);
    assert.equal(loaded.manifest.status, 'declared');
  } finally {
    rmTmpDir(dir);
  }
});

test('a demo definition that fails validation is reported, not silently skipped', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-manifest-fn-'));
  try {
    const manifestDir = path.join(dir, '.construct', 'demos', 'manifests');
    fs.mkdirSync(manifestDir, { recursive: true });
    fs.writeFileSync(path.join(manifestDir, 'broken.json'), JSON.stringify({
      schema: DEMO_MANIFEST_SCHEMA,
      name: 'broken',
    }, null, 2), 'utf8');

    const loaded = loadDemoManifest('broken', { cwd: dir, repoRoot: dir });
    assert.equal(loaded.ok, false);
    assert.ok(loaded.errors.length > 0, 'expected named validation errors, not a silent skip');
  } finally {
    rmTmpDir(dir);
  }
});

test('a demo not present in any search dir fails loudly rather than returning null', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-manifest-fn-'));
  try {
    const loaded = loadDemoManifest('does-not-exist', { cwd: dir, repoRoot: dir });
    assert.equal(loaded.ok, false);
    assert.ok(loaded.errors.some((e) => e.includes('does-not-exist')));
  } finally {
    rmTmpDir(dir);
  }
});

test('the graph-write helper produces a node whose type is in NODE_TYPES', () => {
  const node = demoManifestGraphNode(wellFormedManifest());
  assert.ok(NODE_TYPES.has(node.type), `expected node.type '${node.type}' to be a valid graph NODE_TYPE`);
  assert.equal(node.id, `contract:demo-manifest:tour`);
  assert.equal(node.attrs.status, 'declared');
});
