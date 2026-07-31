/**
 * tests/audit/f12-gates/gate-red-fixture-inventory.red.mjs — R28/R31/R33 gate-trust gap.
 *
 * A release gate is only trustworthy if a red fixture proves it FAILS for the
 * defect it claims to catch. Today the release surface chains many gates
 * (package.json scripts.release:check + the CI jobs in .github/workflows/ci.yml)
 * but there is no registry that maps each P0/P1 gate to the red/forced-failure
 * fixture that proves it detects its defect.
 *
 * Assert that such a manifest exists and that every enumerated P0/P1 gate has
 * a registered red fixture whose file is present on disk. RED today on two
 * counts: (1) the manifest file does not exist, and (2) even the already-written
 * audit red fixtures (tests/audit/f01..f08) are not registered anywhere a gate
 * can discover them. GREEN once bead -001 lands the manifest and wires each gate
 * to its proving fixture.
 *
 * NOTE: this family DEPENDS on F01–F11 producing their red fixtures; this gate
 * is the meta-gate that refuses to trust an untested gate.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(MODULE_DIR, '..', '..', '..');

// Candidate locations for the gate→red-fixture registry. The fix (bead -001)
// may land it as JSON or as a generated module; any of these satisfying the
// schema flips this fixture green.

const MANIFEST_CANDIDATES = [
  path.join(REPO_ROOT, 'tests', 'audit', 'gate-fixture-manifest.json'),
  path.join(REPO_ROOT, 'registry', 'gate-fixtures.json'),
  path.join(REPO_ROOT, 'lib', 'gates', 'red-fixture-manifest.mjs'),
];

// The P0/P1 release gates whose defect-detection must be proven. Each maps to
// the audit family that should carry its red fixture. The manifest must cover
// at least these — a gate with no proving fixture is an untrusted gate.

const REQUIRED_GATE_IDS = [
  'mcp-safety',
  'secret-scan',
  'consumer-dependency-audit',
  'host-readiness',
  'runtime-ownership',
  'docker-runtime-smoke',
  'cicd-permissions',
  'prompt-injection',
  'registry-validate-p0p1',
  'template-policy',
];

function loadManifest() {
  for (const candidate of MANIFEST_CANDIDATES) {
    if (!fs.existsSync(candidate)) continue;
    if (candidate.endsWith('.json')) {
      return { path: candidate, data: JSON.parse(fs.readFileSync(candidate, 'utf8')) };
    }
    return { path: candidate, data: null, isModule: true };
  }
  return null;
}

describe('R28/R31/R33 — every P0/P1 release gate has a registered red fixture', () => {
  it('a gate→red-fixture manifest exists', () => {
    const found = loadManifest();
    assert.ok(
      found,
      `no gate-fixture manifest found at any of: ${MANIFEST_CANDIDATES.map((p) => path.relative(REPO_ROOT, p)).join(', ')} — release gates are unproven`
    );
  });

  it('every required P0/P1 gate is registered with a fixture path on disk', () => {
    const found = loadManifest();
    assert.ok(found && found.data && Array.isArray(found.data.gates),
      'manifest must be JSON with a top-level `gates` array of { id, redFixture, criticality }');

    const byId = new Map(found.data.gates.map((g) => [g.id, g]));
    const missing = [];
    const danglingFixture = [];

    for (const gateId of REQUIRED_GATE_IDS) {
      const entry = byId.get(gateId);
      if (!entry) {
        missing.push(gateId);
        continue;
      }
      if (!entry.redFixture) {
        missing.push(`${gateId} (no redFixture field)`);
        continue;
      }
      const fixturePath = path.isAbsolute(entry.redFixture)
        ? entry.redFixture
        : path.join(REPO_ROOT, entry.redFixture);
      if (!fs.existsSync(fixturePath)) {
        danglingFixture.push(`${gateId} → ${entry.redFixture}`);
      }
    }

    assert.deepEqual(missing, [], `gates with no registered red fixture: ${missing.join(', ')}`);
    assert.deepEqual(
      danglingFixture,
      [],
      `gates whose registered red fixture is absent on disk: ${danglingFixture.join(', ')}`
    );
  });

  it('every registered red fixture is wired into the suite (renamed from *.red.mjs)', () => {
    const found = loadManifest();
    assert.ok(found && found.data && Array.isArray(found.data.gates), 'manifest must be loadable');

    // A gate that still points at a *.red.mjs file is in the red phase: the fix
    // has not landed, so the gate is not yet wired into `npm test`. Once green,
    // the proving fixture is renamed to *.test.mjs.

    const stillRed = found.data.gates
      .filter((g) => typeof g.redFixture === 'string' && g.redFixture.endsWith('.red.mjs'))
      .map((g) => g.id);

    assert.deepEqual(
      stillRed,
      [],
      `gates still pointing at unwired *.red.mjs fixtures (fix not landed): ${stillRed.join(', ')}`
    );
  });
});
