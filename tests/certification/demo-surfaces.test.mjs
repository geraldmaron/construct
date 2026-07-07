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

  // Only path.join('templates', 'demos', 'tapes', '<name>.tape') literals name a
  // canonical tape; a bare /construct demo/ mention or a scaffolded project tape
  // (e.g. my-demo.tape) doesn't count, so isolate the former before cross-checking.
  const tapeRefs = [...demo.matchAll(/templates',\s*'demos',\s*'tapes',\s*'([^']+\.tape)'/g)].map((m) => m[1]);
  assert.ok(tapeRefs.length >= 1, 'expected the functional harness to name at least one canonical tape by path');
  const tapesDir = path.join(REPO, 'templates/demos/tapes');
  for (const tape of tapeRefs) {
    assert.ok(fs.existsSync(path.join(tapesDir, tape)), `harness references ${tape} but it is missing from ${tapesDir}`);
  }
});
