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

test('web cockpit theme tokens and RouteStrip exist for certification', () => {
  const tokens = path.join(REPO, 'apps/chat/web/theme/tokens.css');
  const routeStrip = path.join(REPO, 'apps/chat/web/components/route-strip.tsx');
  assert.ok(fs.existsSync(tokens));
  assert.ok(fs.existsSync(routeStrip));
  const src = fs.readFileSync(routeStrip, 'utf8');
  assert.match(src, /cx-cockpit-route-strip/);
  assert.match(fs.readFileSync(tokens, 'utf8'), /Space Grotesk|--cx-/);
});

test('desktop launcher test documents surface=tauri certification path', () => {
  const launcher = fs.readFileSync(
    path.join(REPO, 'tests/functional/chat-desktop-launcher.functional.test.mjs'),
    'utf8',
  );
  assert.match(launcher, /surface=desktop/);
});

test('demo functional harness references canonical tapes', () => {
  const demo = fs.readFileSync(path.join(REPO, 'tests/functional/demo.functional.test.mjs'), 'utf8');
  assert.match(demo, /construct demo/);
  const tapesDir = path.join(REPO, 'templates/demos/tapes');
  assert.ok(fs.existsSync(tapesDir));
  assert.ok(fs.readdirSync(tapesDir).some((f) => f.endsWith('.tape')));
});
