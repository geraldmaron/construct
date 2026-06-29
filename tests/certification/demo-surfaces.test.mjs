/**
 * tests/certification/demo-surfaces.test.mjs — Tauri/web/VHS demo certification harness markers.
 *
 * @capability demo.terminal-fallback
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadCanonicalScenarios } from '../../lib/certification/canonical-scenarios.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('canonical demo catalog cites construct cockpit tapes and themes', () => {
  const { catalog } = loadCanonicalScenarios({ rootDir: REPO });
  assert.ok((catalog.demos ?? []).length >= 2);
  for (const demo of catalog.demos ?? []) {
    assert.ok(demo.tape?.includes('templates/demos/tapes/'));
  }
});

test('demo functional harness references canonical tapes', () => {
  const demo = fs.readFileSync(path.join(REPO, 'tests/functional/demo.functional.test.mjs'), 'utf8');
  assert.match(demo, /construct demo/);
  const tapesDir = path.join(REPO, 'templates/demos/tapes');
  assert.ok(fs.existsSync(tapesDir));
  assert.ok(fs.readdirSync(tapesDir).some((f) => f.endsWith('.tape')));
});
