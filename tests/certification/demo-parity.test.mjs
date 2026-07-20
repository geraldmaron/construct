/**
 * tests/certification/demo-parity.test.mjs — cross-surface demo parity report.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildDemoParityReport } from '../../lib/certification/demo-parity.mjs';
import { persistDemoState } from '../../lib/demo-state.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('canonical demos pass cross-surface parity probes when verified state is present', () => {
  const stateCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-parity-report-'));
  for (const id of [
    'agentic-platforms-prd',
    'construct-cockpit',
    'architecture-review-adr',
    'capability-contract',
    'intake-triage',
    'profile-doctor-health',
  ]) {
    persistDemoState(id, { cwd: stateCwd, state: 'verified', enforceTransition: false });
  }
  const report = buildDemoParityReport({ rootDir: REPO, stateCwd });
  assert.equal(report.pass, true, JSON.stringify(report.mismatches, null, 2));
  assert.ok(report.acceptableDivergences.length >= 1);
  assert.equal(report.stateAware, true);
});
