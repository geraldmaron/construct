/**
 * tests/audit/f10-registry-drift/catalog-semantic-drift.red.mjs — F10 [R32] catalog drift is blind.
 *
 * RED fixtures (must FAIL against current code). lib/registry/catalog.mjs detects drift by
 * comparing the on-disk capabilities.json against a freshly built snapshot — but the snapshot
 * is built by reading the SAME on-disk file, so only derived fields can ever differ:
 *   - catalog.mjs:79  buildCatalogSnapshot loads raw via loadCapabilityRegistry(rootDir) and
 *     spreads each capability with `...cap` (L80-83); semantic fields (description,
 *     criticality, verification, lastValidated, skill) are copied through unchanged.
 *   - catalog.mjs:121  checkCapabilityCatalogDrift compares onDisk against that snapshot, so
 *     every non-derived field is identical on both sides by construction.
 *   - catalog.mjs:123-127 generatedAt is additionally stripped before comparison.
 * Only edges, catalog.npmScripts, catalog.cliCommands, and catalog.workflowTypes — the fields
 * regenerated from external sources (package.json, CLI_COMMANDS, workflow-defs) — can register
 * as drift. A capability whose stored description, criticality, or verification path diverges
 * from repo reality passes the drift check silently.
 *
 * Contract these encode (CX-AUDIT-REGISTRY-004): semantic capability content must be generated
 * from a source of truth and re-validated against it, so a false description or a verification
 * path that points nowhere is caught as drift — not just timestamp churn or derived-edge skew.
 * Each test regenerates a clean catalog, mutates a semantic field on disk, and asserts the
 * drift check fires; today it reports drift:false, so the asserts fail until semantic content
 * is generated rather than free-stored.
 *
 * Hermetic: a self-contained rootDir (package.json + registry/) under fs.mkdtemp(os.tmpdir()).
 * checkCapabilityCatalogDrift reads only package.json and capabilities.json from rootDir, so
 * the repo's own registry is never touched. No network, no host state.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { regenerateCapabilityCatalog, checkCapabilityCatalogDrift } from '../../../lib/registry/catalog.mjs';

const CAPABILITIES_REL = path.join('registry', 'capabilities.json');

// Stage a minimal but complete rootDir, then regenerate so the catalog block and per-capability
// edges are present and non-drifting. The returned dir is a clean baseline: checkCapabilityCatalogDrift
// reports drift:false until a field is mutated.

function stageRegeneratedRegistry(capabilities) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-f10-semantic-'));
  fs.mkdirSync(path.join(dir, 'registry'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), `${JSON.stringify({ name: 'cx-f10-fixture', scripts: { build: 'echo build' } }, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(dir, CAPABILITIES_REL), `${JSON.stringify({ version: 1, capabilities }, null, 2)}\n`, 'utf8');
  regenerateCapabilityCatalog({ rootDir: dir });
  return dir;
}

function readCapabilities(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, CAPABILITIES_REL), 'utf8'));
}

function writeCapabilities(dir, doc) {
  fs.writeFileSync(path.join(dir, CAPABILITIES_REL), `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
}

// A capability description is human-authored claim text. Rewriting it to claim something false
// must register as drift against the source of truth. Today both sides of the comparison read
// the same on-disk description, so the change is invisible.

test('[R32] a falsified capability description is detected as drift', () => {
  const dir = stageRegeneratedRegistry([
    { id: 'alpha.thing', criticality: 'P1', description: 'Original truthful description.', verification: {}, surfaces: {} },
  ]);
  try {
    assert.equal(checkCapabilityCatalogDrift({ rootDir: dir }).drift, false, 'baseline must be drift-free after regenerate');

    const doc = readCapabilities(dir);
    doc.capabilities[0].description = 'Falsified description claiming behavior that does not exist.';
    writeCapabilities(dir, doc);

    assert.equal(
      checkCapabilityCatalogDrift({ rootDir: dir }).drift,
      true,
      'a falsified capability description must be detected as drift, but the check reported drift:false',
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// criticality drives the fail-closed gate (P0/P1 get stricter checks). Silently downgrading a
// capability from P0 to P3 must register as drift, otherwise the gate's own input can be edited
// away from reality without detection.

test('[R32] a silently downgraded criticality is detected as drift', () => {
  const dir = stageRegeneratedRegistry([
    { id: 'beta.thing', criticality: 'P0', description: 'A critical capability.', verification: {}, surfaces: {} },
  ]);
  try {
    assert.equal(checkCapabilityCatalogDrift({ rootDir: dir }).drift, false, 'baseline must be drift-free after regenerate');

    const doc = readCapabilities(dir);
    doc.capabilities[0].criticality = 'P3';
    writeCapabilities(dir, doc);

    assert.equal(
      checkCapabilityCatalogDrift({ rootDir: dir }).drift,
      true,
      'a P0→P3 criticality downgrade must be detected as drift, but the check reported drift:false',
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// A verification.functional path absent from the repo is semantic drift against reality: the
// registry claims a test the filesystem lacks. The catalog drift check must catch a stored path
// diverging from the filesystem, not only derived-edge skew.

test('[R32] a verification path pointing nowhere is detected as drift', () => {
  const dir = stageRegeneratedRegistry([
    { id: 'gamma.thing', criticality: 'P1', description: 'Has a verification path.', verification: { functional: 'tests/functional/real-at-regen.mjs' }, surfaces: {} },
  ]);
  try {
    assert.equal(checkCapabilityCatalogDrift({ rootDir: dir }).drift, false, 'baseline must be drift-free after regenerate');

    const doc = readCapabilities(dir);
    doc.capabilities[0].verification.functional = 'tests/functional/this-path-was-deleted.mjs';
    writeCapabilities(dir, doc);

    assert.equal(
      checkCapabilityCatalogDrift({ rootDir: dir }).drift,
      true,
      'a verification path edited to a nonexistent file must be detected as drift, but the check reported drift:false',
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
