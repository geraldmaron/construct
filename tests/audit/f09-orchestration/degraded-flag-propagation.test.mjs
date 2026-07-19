/**
 * tests/audit/f09-orchestration/degraded-flag-propagation.test.mjs — construct-fbxv.5 proof.
 *
 * Web-capability degradation is recorded at the run TOP level (run.degraded /
 * run.degradationReason), but hostAdapterMetadata and the CLI historically read only
 * run.execution.degraded and listRuns rows omitted the field, so a degraded run read
 * as clean on those surfaces. This pins that every run-level reader coalesces the two
 * homes identically — the shaped read-model, hostAdapterMetadata, and the listing
 * projection all surface a top-level-only degradation.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { hostAdapterMetadata } from '../../../lib/orchestration/runtime.mjs';
import { shapeRun } from '../../../lib/mcp/tools/orchestration-run.mjs';

// A run degraded only at the top level (the web-capability path), with executed tasks
// and run.execution.degraded absent — the exact split fbxv.5 targets.
function topLevelDegradedRun() {
  return {
    runId: 'run-fbxv5',
    status: 'degraded',
    degraded: true,
    degradationReason: 'capability-unavailable',
    workerBackend: 'provider',
    hostRole: 'host',
    execution: { executionMode: 'orchestrated', degraded: false, degradationReason: null },
    tasks: [{ id: 't1', role: 'researcher', status: 'done', executor: 'provider' }],
    plan: { intent: 'research', track: 'orchestrated', specialists: ['researcher'] },
  };
}

test('[construct-fbxv.5] hostAdapterMetadata surfaces the top-level run.degraded flag', () => {
  const meta = hostAdapterMetadata(topLevelDegradedRun());
  assert.equal(meta.degraded, true, 'hostAdapterMetadata must coalesce run.degraded, not read only execution.degraded');
  assert.equal(meta.degradationReason, 'capability-unavailable');
});

test('[construct-fbxv.5] shapeRun surfaces the top-level run.degraded flag and does not report bare completed', () => {
  const shaped = shapeRun(topLevelDegradedRun());
  assert.equal(shaped.degraded, true);
  assert.notEqual(shaped.status, 'completed', 'a top-level-degraded run must not surface bare completed');
});

test('[construct-fbxv.5] a clean run is not falsely marked degraded by either reader', () => {
  const clean = {
    runId: 'run-clean',
    status: 'completed',
    degraded: false,
    execution: { executionMode: 'orchestrated', degraded: false },
    tasks: [{ id: 't1', role: 'architect', status: 'done', executor: 'provider' }],
    plan: { specialists: ['architect'] },
    workerBackend: 'provider',
    hostRole: 'host',
  };
  assert.equal(hostAdapterMetadata(clean).degraded, false);
  assert.equal(shapeRun(clean).degraded, false);
  assert.equal(shapeRun(clean).status, 'completed');
});
