/**
 * tests/audit/f10-registry-drift/fail-closed-validation.red.mjs — F10 [R33] registry fails open.
 *
 * RED fixtures (must FAIL against current code). lib/registry/validate.mjs treats two
 * conditions on a P0/P1 capability as WARNINGS, not errors, so validation passes (valid:true,
 * exit 0) even when a critical capability is untested or unverified for months:
 *   - validate.mjs:87-90  a P0/P1 cap with no functional test, no hostEmulation, and no
 *     untestableRationale → warnings.push(...), never errors.push(...).
 *   - validate.mjs:105-112 a lastValidated older than STALE_MS (90 days) → warnings.push(...).
 *   - validate.mjs:129  valid = (errors.length === 0); warnings never flip it.
 *   - lib/registry/cli.mjs:153  runRegistryValidate returns `report.valid ? 0 : 1`, so the
 *     gate exits 0 with these warnings present.
 *
 * Contract these encode: a P0/P1 capability with missing tests OR a
 * stale lastValidated must FAIL the registry gate (valid:false / non-zero exit), not merely
 * warn. A safety-critical contract that can rot for 200 days while the gate stays green is
 * fail-open. Each test drives the real validateCapabilityRegistry against a crafted registry
 * and asserts it fails; today it returns valid:true, so the asserts fail until the checks
 * fail closed.
 *
 * Hermetic: the registry is written under fs.mkdtemp(os.tmpdir()) and passed as rootDir.
 * `now` is injected so the staleness boundary is deterministic. No network, no host state.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { validateCapabilityRegistry } from '../../../lib/registry/validate.mjs';

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-06-30T00:00:00.000Z');

// Stage a hermetic rootDir whose registry/capabilities.json holds exactly the capabilities
// passed in. loadCapabilityRegistry reads <rootDir>/registry/capabilities.json, so the real
// validator runs against this crafted file with no contact with the repo's own registry.

function stageRegistry(capabilities) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-f10-failclosed-'));
  fs.mkdirSync(path.join(dir, 'registry'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'registry', 'capabilities.json'),
    `${JSON.stringify({ version: 1, capabilities }, null, 2)}\n`,
    'utf8',
  );
  return dir;
}

// A P0 capability with an empty verification block (no functional, no hostEmulation, no
// untestableRationale) is a critical contract with nothing proving it works. The gate must
// reject it. Today validate.mjs:88-90 only warns.

test('[R33] P0 capability with no test fails the registry gate', () => {
  const dir = stageRegistry([
    {
      id: 'critical.untested',
      criticality: 'P0',
      verification: {},
      lastValidated: new Date(NOW).toISOString(),
      surfaces: {},
    },
  ]);
  try {
    const report = validateCapabilityRegistry({ rootDir: dir, now: NOW });
    assert.equal(
      report.valid,
      false,
      `P0 capability with no functional test or untestableRationale must fail the gate, got valid=${report.valid} with warnings: ${JSON.stringify(report.warnings)}`,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// A P1 capability last validated 200 days ago is unverified well past the 90-day staleness
// boundary. The gate must reject it. Today validate.mjs:107-108 only warns.

test('[R33] P1 capability with stale lastValidated fails the registry gate', () => {
  const staleIso = new Date(NOW - 200 * 24 * 60 * 60 * 1000).toISOString();
  const dir = stageRegistry([
    {
      id: 'critical.stale',
      criticality: 'P1',
      verification: { functional: 'tests/functional/orchestration-mcp.functional.test.mjs' },
      lastValidated: staleIso,
      surfaces: {},
    },
  ]);
  try {
    const report = validateCapabilityRegistry({ rootDir: dir, now: NOW });
    assert.equal(
      report.valid,
      false,
      `P1 capability with lastValidated ${staleIso} (>${NINETY_DAYS_MS}ms old) must fail the gate, got valid=${report.valid} with warnings: ${JSON.stringify(report.warnings)}`,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// Combined worst case: a P0 capability both untested and stale — nothing proves it works and
// nothing re-checked it in 200 days — must fail with at least one error, not sail through on
// valid:true with zero errors.

test('[R33] P0 capability that is both untested and stale fails the registry gate', () => {
  const staleIso = new Date(NOW - 200 * 24 * 60 * 60 * 1000).toISOString();
  const dir = stageRegistry([
    {
      id: 'critical.untested.stale',
      criticality: 'P0',
      verification: {},
      lastValidated: staleIso,
      surfaces: {},
    },
  ]);
  try {
    const report = validateCapabilityRegistry({ rootDir: dir, now: NOW });
    assert.equal(report.errors.length > 0, true,
      `an untested + stale P0 capability must produce at least one error, got errors=${JSON.stringify(report.errors)}`);
    assert.equal(report.valid, false,
      `an untested + stale P0 capability must fail the gate, got valid=${report.valid}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
