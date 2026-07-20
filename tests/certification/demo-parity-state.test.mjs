/**
 * tests/certification/demo-parity-state.test.mjs — state-aware demo certification gate (construct-tsyfe.5.8).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildDemoParityReport,
  evaluateDemoCertificationState,
} from '../../lib/certification/demo-parity.mjs';
import { persistDemoState } from '../../lib/demo-state.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function seedVerifiedStates(stateCwd, ids) {
  for (const id of ids) {
    persistDemoState(id, {
      cwd: stateCwd,
      state: 'verified',
      enforceTransition: false,
    });
  }
}

test('script-only state fails certification with explicit reason', () => {
  const stateCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-parity-script-only-'));
  persistDemoState('agentic-platforms-prd', {
    cwd: stateCwd,
    state: 'script-only',
    enforceTransition: false,
  });
  const result = evaluateDemoCertificationState('agentic-platforms-prd', {
    rootDir: REPO,
    stateCwd,
  });
  assert.equal(result.pass, false);
  assert.match(result.reason, /script-only/);
});

test('recorded alone fails certification', () => {
  const stateCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-parity-recorded-'));
  persistDemoState('agentic-platforms-prd', {
    cwd: stateCwd,
    state: 'recorded',
    enforceTransition: false,
  });
  const result = evaluateDemoCertificationState('agentic-platforms-prd', {
    rootDir: REPO,
    stateCwd,
  });
  assert.equal(result.pass, false);
  assert.match(result.reason, /not verified/);
});

test('verified state passes certification', () => {
  const stateCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-parity-verified-'));
  persistDemoState('agentic-platforms-prd', {
    cwd: stateCwd,
    state: 'verified',
    enforceTransition: false,
  });
  const result = evaluateDemoCertificationState('agentic-platforms-prd', {
    rootDir: REPO,
    stateCwd,
  });
  assert.equal(result.pass, true);
});

test('stale tape file with unavailable state fails terminal certification', () => {
  const stateCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-parity-stale-'));
  persistDemoState('agentic-platforms-prd', {
    cwd: stateCwd,
    state: 'unavailable',
    enforceTransition: false,
  });
  const report = buildDemoParityReport({ rootDir: REPO, stateCwd });
  const demo = report.demos.find((entry) => entry.id === 'agentic-platforms-prd');
  assert.ok(demo);
  assert.equal(demo.surfaces.terminal.certificationPass, false);
  assert.equal(demo.surfaces.terminal.artifactPresent, true);
  assert.match(demo.surfaces.terminal.reason, /unavailable/);
});

test('canonical demos pass when verified state is seeded', () => {
  const stateCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-parity-canonical-'));
  seedVerifiedStates(stateCwd, [
    'agentic-platforms-prd',
    'construct-cockpit',
    'architecture-review-adr',
    'capability-contract',
    'intake-triage',
    'profile-doctor-health',
  ]);
  const report = buildDemoParityReport({ rootDir: REPO, stateCwd });
  assert.equal(report.stateAware, true);
  assert.equal(report.pass, true, JSON.stringify(report.mismatches, null, 2));
});
