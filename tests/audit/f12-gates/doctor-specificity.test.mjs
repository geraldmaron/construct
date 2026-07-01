/**
 * tests/audit/f12-gates/doctor-specificity.red.mjs — doctor must classify failure states.
 *
 * Best-practice target: doctor is user-facing and issue-specific — "what state
 * failed, why, and how to fix it" — not a binary healthy/unhealthy verdict.
 * Today `cmdDoctor` (bin/construct) records every finding through
 * `add(label, pass, optional)`: a flat boolean per check with no typed failure
 * taxonomy, and `lib/doctor/report.mjs` emits a free-text "Health verdict"
 * section rather than a structured, machine-readable diagnosis.
 *
 * The fix (bead -002) introduces a structured doctor diagnosis: a JSON schema
 * over host / package / secrets / MCP / runtime / deploy states, each finding
 * carrying a distinct failure-state code and a remediation hint. This fixture
 * asserts that contract module exists and enumerates the required states. RED
 * today: no structured-state module is exported. Held as a structural OUTLINE
 * because exercising the full live doctor is heavy and host-dependent.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(MODULE_DIR, '..', '..', '..');

// Candidate homes for the structured-diagnosis contract. The fix may export it
// from a new module or co-locate it under lib/doctor/; any export satisfying the
// state taxonomy below flips this fixture green.

const CONTRACT_CANDIDATES = [
  path.join(REPO_ROOT, 'lib', 'doctor', 'diagnosis.mjs'),
  path.join(REPO_ROOT, 'lib', 'doctor', 'states.mjs'),
  path.join(REPO_ROOT, 'lib', 'doctor', 'schema.mjs'),
];

// Distinct failure states doctor must be able to name. Collapsing any of these
// into a generic "unhealthy" loses the actionable diagnosis the user needs.

const REQUIRED_STATES = [
  'missing-config',
  'stale-path',
  'disabled',
  'server-start-failure',
  'secret-leak',
  'entrypoint-missing',
];

function findContractModule() {
  return CONTRACT_CANDIDATES.find((p) => fs.existsSync(p)) || null;
}

describe('doctor classifies specific failure states (not healthy/unhealthy)', () => {
  it('a structured doctor-diagnosis contract module exists', () => {
    const found = findContractModule();
    assert.ok(
      found,
      `no doctor-state contract found at any of: ${CONTRACT_CANDIDATES.map((p) => path.relative(REPO_ROOT, p)).join(', ')} — doctor has no typed failure taxonomy`
    );
  });

  it('the contract enumerates every required failure state', async () => {
    const found = findContractModule();
    assert.ok(found, 'contract module must exist before its states can be checked');

    const mod = await import(found);
    const states = mod.DOCTOR_STATES || mod.FAILURE_STATES || mod.STATES;
    assert.ok(
      states && (Array.isArray(states) || typeof states === 'object'),
      'contract must export DOCTOR_STATES / FAILURE_STATES / STATES enumerating diagnosis codes'
    );

    const known = new Set(Array.isArray(states) ? states : Object.keys(states));
    const missing = REQUIRED_STATES.filter((s) => !known.has(s));
    assert.deepEqual(
      missing,
      [],
      `doctor cannot distinguish these failure states: ${missing.join(', ')}`
    );
  });

  it('cmdDoctor does not collapse findings into a bare boolean checklist', () => {
    // A typed diagnosis attaches a failure-state field to each finding, so the
    // flat two-arg `add(label, pass, optional)` helper is an absence-of-state
    // signal. Its presence in source means health classification is still binary.

    const binPath = path.join(REPO_ROOT, 'bin', 'construct');
    const src = fs.readFileSync(binPath, 'utf8');

    const flatHelper = /const add = \(label, pass, optional = false\) => checks\.push\(\{ label, pass, optional \}\);/;
    assert.doesNotMatch(
      src,
      flatHelper,
      'cmdDoctor still records findings as flat { label, pass, optional } — no typed failure state attached'
    );
  });
});
