/**
 * tests/functional/demo-manifest-migration.functional.test.mjs — Demo Manifest migration parity (construct-tsyfe.5.5).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { listDemoManifestNames, loadDemoManifest } from '../../lib/demo-manifest.mjs';
import { listDemoRecordings, loadDemoRecording } from '../../lib/demo-recording.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const EXPECTED_MANIFESTS = [
  'agentic-platforms-prd',
  'architecture-review-adr',
  'capability-contract',
  'construct-cockpit',
  'intake-triage',
  'profile-doctor-health',
];

test('every shipped canonical demo is discoverable via the Manifest loader', () => {
  const names = listDemoManifestNames({ repoRoot: REPO });
  for (const name of EXPECTED_MANIFESTS) {
    assert.ok(names.includes(name), `missing manifest: ${name}`);
    const loaded = loadDemoManifest(name, { repoRoot: REPO });
    assert.equal(loaded.ok, true, JSON.stringify(loaded.errors));
    assert.equal(loaded.manifest.schema, 'construct/demo-manifest/1');
  }
});

test('Playwright recording moved from legacy recordings/ into the manifest', () => {
  const legacyPath = path.join(REPO, 'templates/demos/recordings/agentic-platforms-prd.json');
  assert.equal(fs.existsSync(legacyPath), false);
  const recording = loadDemoRecording('agentic-platforms-prd', { repoRoot: REPO });
  assert.ok(recording);
  assert.equal(recording.engine, 'playwright');
  assert.match(recording.sourcePath, /templates\/demos\/manifests\//);
});

test('manifest count matches canonical demo inventory', () => {
  const names = listDemoManifestNames({ repoRoot: REPO });
  assert.equal(names.length, EXPECTED_MANIFESTS.length);
});
