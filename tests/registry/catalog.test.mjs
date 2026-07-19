/**
 * tests/registry/catalog.test.mjs — Living capability catalog regen and validate.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildCatalogSnapshot,
  checkCapabilityCatalogDrift,
  regenerateCapabilityCatalog,
  validateCapabilityCatalog,
} from '../../lib/registry/catalog.mjs';

test('buildCatalogSnapshot stamps catalog census and derived capability edges', () => {
  const snapshot = buildCatalogSnapshot();
  assert.ok(snapshot.catalog);
  assert.ok(snapshot.catalog.npmScripts.length > 0);
  assert.ok(snapshot.catalog.cliCommands.length > 0);
  assert.equal(snapshot.catalog.workflowTypes.length, snapshot.catalog.workflows.length);
  for (const [capabilityId, edges] of Object.entries(snapshot.capabilityEdges)) {
    assert.ok(Array.isArray(edges.cliCommands), `${capabilityId} CLI edges`);
    assert.ok(Array.isArray(edges.npmScripts));
    assert.ok(Array.isArray(edges.workflows));
  }
});

test('regenerate + validate passes and drift check is clean', (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-regen-'));
  t.after(() => {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  });
  fs.cpSync(path.join(process.cwd(), 'registry'), path.join(tmp, 'registry'), { recursive: true });
  fs.copyFileSync(
    path.join(process.cwd(), 'package.json'),
    path.join(tmp, 'package.json'),
  );

  regenerateCapabilityCatalog({ rootDir: tmp });
  const validation = validateCapabilityCatalog({ rootDir: tmp });
  assert.equal(validation.valid, true, validation.errors.join('\n'));
  const drift = checkCapabilityCatalogDrift({ rootDir: tmp });
  assert.equal(drift.drift, false);
});
