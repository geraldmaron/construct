/**
 * tests/doctor/local-production-health.test.mjs — local production go/no-go certification.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  LOCAL_PRODUCTION_CHECK_IDS,
  LOCAL_PRODUCTION_PHILOSOPHY,
  evaluateLocalProductionGate,
  runLocalProductionHealth,
  formatLocalProductionReport,
} from '../../lib/doctor/local-production-health.mjs';
import { enableCapability, writeCapabilityTick } from '../../lib/embed/capability-lifecycle.mjs';

const TEST_CAPABILITY_ID = 'operations';

// runLocalProductionHealth receives an env with CONSTRUCT_HOME_OVERRIDE, but
// enableCapability/writeCapabilityTick in the fixture seeding run outside it
// and resolve the real machine state root through lib/state-root.mjs —
// unpinned, each tmpdir rootDir leaks a real ~/.construct/projects key.

const HOME_OVERRIDE = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-lph-home-'));
const PREV_HOME_OVERRIDE = process.env.CONSTRUCT_HOME_OVERRIDE;
process.env.CONSTRUCT_HOME_OVERRIDE = HOME_OVERRIDE;
test.after(() => {
  if (PREV_HOME_OVERRIDE === undefined) delete process.env.CONSTRUCT_HOME_OVERRIDE;
  else process.env.CONSTRUCT_HOME_OVERRIDE = PREV_HOME_OVERRIDE;
  fs.rmSync(HOME_OVERRIDE, { recursive: true, force: true });
});

function seedEmbedFixture({ rootDir, homeDir }) {
  const configEnv = path.join(homeDir, '.config', 'construct', 'config.env');
  fs.mkdirSync(path.dirname(configEnv), { recursive: true });
  fs.writeFileSync(configEnv, 'GITHUB_TOKEN=test-token\n');

  const runtimeDir = path.join(homeDir, '.local', 'state', 'construct', 'runtime');
  fs.mkdirSync(runtimeDir, { recursive: true });
  fs.writeFileSync(
    path.join(runtimeDir, 'embed-daemon.json'),
    JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }),
  );

  const enabled = enableCapability(TEST_CAPABILITY_ID, {
    rootDir,
    packRoots: [],
    overrides: { embed: { runtime: 'none' } },
  });
  assert.equal(enabled.ok, true, enabled.errors?.join('; ') ?? 'enableCapability failed');
}

function makeCheck(id, pass, overrides = {}) {
  return {
    id,
    pass,
    summary: overrides.summary ?? `${id} ${pass ? 'ok' : 'bad'}`,
    evidence: overrides.evidence ?? {},
    required: overrides.required ?? true,
    skipped: overrides.skipped ?? false,
  };
}

test('LOCAL_PRODUCTION_CHECK_IDS covers Phase 11 criteria', () => {
  assert.equal(LOCAL_PRODUCTION_CHECK_IDS.length, 14);
  assert.match(LOCAL_PRODUCTION_PHILOSOPHY, /Alive is not sufficient/);
});

test('evaluateLocalProductionGate is conjunctive over required checks', () => {
  const passing = evaluateLocalProductionGate({
    checks: [
      makeCheck('scheduler-healthy', true),
      makeCheck('budget-healthy', true),
      makeCheck('oracle-evidence-current', false, { skipped: true, required: false }),
    ],
  });
  assert.equal(passing.go, true);

  const failing = evaluateLocalProductionGate({
    checks: [
      makeCheck('scheduler-healthy', true),
      makeCheck('budget-healthy', false),
    ],
  });
  assert.equal(failing.go, false);
  assert.equal(failing.failures.length, 1);
  assert.equal(failing.failures[0].id, 'budget-healthy');
});

test('alive-but-stale scheduler evidence fails GO (pid alive is not sufficient)', async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lph-alive-'));
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lph-home-'));
  try {
    seedEmbedFixture({ rootDir, homeDir });

    const staleAt = new Date(Date.now() - 8 * 60 * 60_000).toISOString();
    writeCapabilityTick(TEST_CAPABILITY_ID, { status: 'ran', tickedAt: staleAt }, rootDir);

    const result = await runLocalProductionHealth({
      rootDir,
      homeDir,
      env: { GITHUB_TOKEN: 'test-token', CONSTRUCT_HOME_OVERRIDE: homeDir },
    });
    assert.equal(result.go, false);
    const scheduler = result.checks.find((check) => check.id === 'scheduler-healthy');
    assert.equal(scheduler.pass, false);
    assert.match(scheduler.summary, /alive but scheduler evidence is stale/i);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
  }
});

test('fresh scheduler evidence passes scheduler-healthy', async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lph-fresh-'));
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lph-home2-'));
  try {
    seedEmbedFixture({ rootDir, homeDir });

    writeCapabilityTick(TEST_CAPABILITY_ID, { status: 'ran', tickedAt: new Date().toISOString() }, rootDir);

    const result = await runLocalProductionHealth({
      rootDir,
      homeDir,
      env: { GITHUB_TOKEN: 'test-token', CONSTRUCT_HOME_OVERRIDE: homeDir },
    });
    const scheduler = result.checks.find((check) => check.id === 'scheduler-healthy');
    assert.equal(scheduler.pass, true);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
  }
});

test('formatLocalProductionReport renders GO/NO-GO and check lines', () => {
  const text = formatLocalProductionReport({
    go: false,
    philosophy: LOCAL_PRODUCTION_PHILOSOPHY,
    summary: 'NO-GO — 1 required check(s) failed',
    checks: [makeCheck('budget-healthy', false)],
    failures: [{ id: 'budget-healthy', summary: 'over cap' }],
  });
  assert.match(text, /NO-GO/);
  assert.match(text, /\[FAIL\] budget-healthy/);
});
