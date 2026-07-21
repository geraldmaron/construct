/**
 * tests/artifact-lifecycle.test.mjs — lifecycle handoff object shape and state mapping.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LIFECYCLE_STATES,
  buildAuthorArtifactLifecycle,
  buildPreparedRunLifecycle,
  buildProcedurePlanLifecycle,
  buildPublishLifecycle,
  isLifecycleState,
  withInvokePlanLifecycle,
} from '../lib/artifact-lifecycle.mjs';

function assertLifecycleShape(lifecycle, { state }) {
  assert.ok(lifecycle && typeof lifecycle === 'object');
  assert.equal(lifecycle.state, state);
  assert.ok(isLifecycleState(lifecycle.state));
  assert.ok(lifecycle.evidence && typeof lifecycle.evidence === 'object');
  assert.equal(typeof lifecycle.nextAction, 'string');
  assert.ok(lifecycle.nextAction.length > 0);
  if (lifecycle.nextCommand != null) {
    assert.equal(typeof lifecycle.nextCommand, 'string');
  }
}

test('LIFECYCLE_STATES includes planned through published', () => {
  assert.deepEqual(LIFECYCLE_STATES, [
    'planned',
    'prepared',
    'executed',
    'drafted',
    'validated',
    'published',
  ]);
});

test('buildProcedurePlanLifecycle reports plan-only honesty', () => {
  const lifecycle = buildProcedurePlanLifecycle({
    procedureId: 'prd-draft',
    status: 'proposed',
    traceId: 'trace-1',
    selectedWorkerProfiles: ['product-manager', 'architect'],
  }, { artifactType: 'prd-platform' });
  assertLifecycleShape(lifecycle, { state: 'planned' });
  assert.equal(lifecycle.evidence.procedureStatus, 'proposed');
  assert.equal(lifecycle.evidence.artifactType, 'prd-platform');
  assert.match(lifecycle.nextAction, /plan only/i);
});

test('buildPreparedRunLifecycle reports prepared not authored', () => {
  const lifecycle = buildPreparedRunLifecycle({
    runId: 'run-1',
    executionState: 'prepared',
    artifactType: 'adr',
  });
  assertLifecycleShape(lifecycle, { state: 'prepared' });
  assert.match(lifecycle.nextAction, /prepared/i);
  assert.match(lifecycle.nextAction, /not authored/i);
});

test('buildAuthorArtifactLifecycle maps draft missing to planned', () => {
  const lifecycle = buildAuthorArtifactLifecycle({
    invokePlan: { procedureId: 'architecture-review', status: 'proposed', traceId: 't2' },
    artifactType: 'adr',
    relPath: null,
    draftMissing: true,
  });
  assertLifecycleShape(lifecycle, { state: 'planned' });
});

test('buildAuthorArtifactLifecycle maps gate fail to drafted', () => {
  const lifecycle = buildAuthorArtifactLifecycle({
    invokePlan: { traceId: 't3' },
    artifactType: 'runbook',
    relPath: 'docs/runbooks/2026-07-20-sample.md',
    validation: { ok: false, errors: ['missing mermaid'] },
  });
  assertLifecycleShape(lifecycle, { state: 'drafted' });
  assert.equal(lifecycle.evidence.gate, 'FAIL');
  assert.match(lifecycle.nextCommand, /artifact validate/);
});

test('buildAuthorArtifactLifecycle maps gate pass to validated', () => {
  const lifecycle = buildAuthorArtifactLifecycle({
    invokePlan: { traceId: 't4' },
    artifactType: 'research-brief',
    relPath: '.construct/research/2026-07-20-sample.md',
    validation: { ok: true, errors: [] },
  });
  assertLifecycleShape(lifecycle, { state: 'validated' });
  assert.equal(lifecycle.evidence.gate, 'PASS');
  assert.match(lifecycle.nextCommand, /construct publish/);
});

test('buildPublishLifecycle maps successful export to published', () => {
  const lifecycle = buildPublishLifecycle({
    ok: true,
    inputPath: 'docs/specs/prd/sample.md',
    outputPath: '.construct/publish/sample.pdf',
    artifactType: 'prd',
  });
  assertLifecycleShape(lifecycle, { state: 'published' });
  assert.equal(lifecycle.evidence.exportPath, '.construct/publish/sample.pdf');
});

test('withInvokePlanLifecycle attaches plan lifecycle without mutating input', () => {
  const plan = { procedureId: 'prd-draft', status: 'proposed' };
  const enriched = withInvokePlanLifecycle(plan, { artifactType: 'prd' });
  assert.notEqual(enriched, plan);
  assertLifecycleShape(enriched.lifecycle, { state: 'planned' });
  assert.equal(plan.lifecycle, undefined);
});
