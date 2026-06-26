/**
 * demo-plugin.functional.test.mjs — `construct demo init --from-project` plug-in layer.
 *
 * @capability demo.terminal-fallback
 *
 * Contract: in a project, `construct demo init <name> --from-project` scaffolds
 * a project demo plug-in under .cx/demos/ — a manifest (<name>.project.json), a
 * chat-guided script, and a terminal tape stub — seeded from real project
 * signals (no fabricated scenario content). The manifest must validate against
 * schemas/project-demo.schema.json, and the scaffolded script must load through
 * the same demo-script loader the chat surface uses. Hermetic: an isolated tmp
 * project, the real binary, durable artifacts.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';

import { loadDemoScript } from '../../lib/demo-script.mjs';
import { loadProjectDemoManifest, PROJECT_DEMO_SCHEMA } from '../../lib/demo-project.mjs';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const BIN = path.join(REPO, 'bin', 'construct');
const SCHEMA_PATH = path.join(REPO, 'schemas', 'project-demo.schema.json');

// A dependency-free conformance check driven by the real schema file: Construct
// keeps no ajv at startup (lib/demo-project.mjs validates by hand), and ajv is
// only a transitive dependency here, so the test enforces the schema's own
// required/const/pattern/enum/additionalProperties rules rather than importing it.

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
    if (spec.minLength !== undefined && typeof v === 'string' && v.length < spec.minLength) errors.push(`${key} too short`);
    if (spec.pattern && typeof v === 'string' && !new RegExp(spec.pattern).test(v)) errors.push(`${key} fails pattern ${spec.pattern}`);
  }
  return errors;
}

function run(args, cwd) {
  return spawnSync(BIN, args, {
    cwd,
    encoding: 'utf8',
    timeout: 60_000,
    env: { ...process.env, CONSTRUCT_SKIP_BOOTSTRAP_PROBE: '1', BOOTSTRAP_CHECKED: '1', CONSTRUCT_DISABLE_AUTO_CLEANUP: '1' },
  });
}

function makeProject(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-plugin-'));
  fs.writeFileSync(path.join(dir, 'package.json'), `${JSON.stringify({ name, version: '0.0.0' }, null, 2)}\n`, 'utf8');
  return dir;
}

test('construct demo init --from-project scaffolds .cx/demos plug-in seeded from the project name', () => {
  const dir = makeProject('acme-widgets');
  try {
    const result = run(['demo', 'init', 'walkthrough', '--from-project'], dir);
    assert.equal(result.status, 0, `expected exit 0, got ${result.status}. stderr: ${result.stderr}`);

    const manifestPath = path.join(dir, '.cx', 'demos', 'walkthrough.project.json');
    const scriptPath = path.join(dir, '.cx', 'demos', 'scripts', 'walkthrough.json');
    const tapePath = path.join(dir, '.cx', 'demos', 'tapes', 'walkthrough.tape');
    assert.ok(fs.existsSync(manifestPath), 'expected manifest .cx/demos/walkthrough.project.json');
    assert.ok(fs.existsSync(scriptPath), 'expected script .cx/demos/scripts/walkthrough.json');
    assert.ok(fs.existsSync(tapePath), 'expected tape .cx/demos/tapes/walkthrough.tape');

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    assert.equal(manifest.schema, PROJECT_DEMO_SCHEMA);
    assert.equal(manifest.name, 'walkthrough');
    assert.equal(manifest.project, 'acme-widgets', 'project name must come from the real package.json signal');
    assert.equal(manifest.script, '.cx/demos/scripts/walkthrough.json');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('scaffolded manifest validates against schemas/project-demo.schema.json', () => {
  const dir = makeProject('beta-co');
  try {
    const result = run(['demo', 'init', 'tour', '--from-project'], dir);
    assert.equal(result.status, 0, result.stderr);

    const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, '.cx', 'demos', 'tour.project.json'), 'utf8'));
    const schemaErrors = validateAgainstSchema(schema, manifest);
    assert.deepEqual(schemaErrors, [], `schema errors: ${schemaErrors.join('; ')}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('scaffolded script loads through the demo-script loader and runs read-only commands', () => {
  const dir = makeProject('gamma-labs');
  try {
    assert.equal(run(['demo', 'init', 'intro', '--from-project'], dir).status, 0);

    const script = loadDemoScript('intro', { cwd: dir, repoRoot: REPO });
    assert.ok(script, 'expected the scaffolded script to load from .cx/demos/scripts/');
    assert.ok(script.steps.length >= 1, 'expected at least one step');
    for (const step of script.steps) {
      assert.match(step.command, /^node bin\/construct /, 'steps must invoke read-only construct commands');
    }

    const loaded = loadProjectDemoManifest('intro', { cwd: dir });
    assert.equal(loaded.ok, true, `manifest load failed: ${loaded.errors?.join('; ')}`);
    assert.equal(loaded.manifest.project, 'gamma-labs');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('construct demo init --from-project refuses to clobber an existing plug-in', () => {
  const dir = makeProject('delta-inc');
  try {
    assert.equal(run(['demo', 'init', 'dup', '--from-project'], dir).status, 0);
    const second = run(['demo', 'init', 'dup', '--from-project'], dir);
    assert.equal(second.status, 1, 'a second scaffold of the same name must fail');
    assert.match(second.stderr, /already exists/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('construct demo init --from-project requires a name', () => {
  const dir = makeProject('epsilon');
  try {
    const result = run(['demo', 'init', '--from-project'], dir);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Usage: construct demo init <name> --from-project/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
