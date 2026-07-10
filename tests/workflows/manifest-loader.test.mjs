/**
 * tests/workflows/manifest-loader.test.mjs — unit tests for workflow manifest loader.
 */

import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync, rmSync } from 'node:fs';
import test from 'node:test';

import {
  loadWorkflowManifestsFromDir, mergeWorkflowManifests,
  resolveWorkflowManifestDirs, loadAllWorkflows,
} from '../../lib/workflows/loader.mjs';

test('loadWorkflowManifestsFromDir: loads manifests from builtin dir', () => {
  const dirs = resolveWorkflowManifestDirs();
  const { manifests, errors } = loadWorkflowManifestsFromDir(dirs.builtin);
  assert.equal(errors.length, 0, `unexpected errors: ${errors.join(', ')}`);
  assert.ok(manifests.length >= 10, `expected >=10 manifests, got ${manifests.length}`);
  const ids = manifests.map((m) => m.id).sort();
  assert.ok(ids.includes('prd-draft'));
  assert.ok(ids.includes('evidence-ingest'));
  assert.ok(ids.includes('architecture-review'));
});

test('loadWorkflowManifestsFromDir: non-existent dir returns empty', () => {
  const { manifests, errors } = loadWorkflowManifestsFromDir('/tmp/nonexistent-workflow-dir-xyz');
  assert.deepEqual(manifests, []);
  assert.deepEqual(errors, []);
});

test('loadWorkflowManifestsFromDir: invalid JSON reports error', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'wf-test-'));
  try {
    writeFileSync(join(tmpDir, 'bad.manifest.json'), '{invalid json}', 'utf8');
    const { manifests, errors } = loadWorkflowManifestsFromDir(tmpDir);
    assert.deepEqual(manifests, []);
    assert.ok(errors.length > 0);
    assert.ok(errors[0].includes('failed to parse JSON'));
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('loadWorkflowManifestsFromDir: strict mode rejects unknown fields', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'wf-test-'));
  try {
    writeFileSync(join(tmpDir, 'strict-bad.manifest.json'), JSON.stringify({
      id: 'test-wf',
      version: '1.0.0',
      type: 'linear',
      defaultApprovalMode: 'proposal-only',
      unknownField: 'should-be-rejected',
    }), 'utf8');
    const { manifests, errors } = loadWorkflowManifestsFromDir(tmpDir, { strict: true });
    assert.deepEqual(manifests, []);
    assert.ok(errors.length > 0);
    assert.ok(errors[0].includes('unknown field'));
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('mergeWorkflowManifests: project overrides pack overrides builtin', () => {
  const builtin = [
    { id: 'wf-a', tier: 'fast', defaultApprovalMode: 'proposal-only', roleChain: ['researcher'] },
    { id: 'wf-b', tier: 'standard', defaultApprovalMode: 'requires-human-approval', roleChain: ['architect'] },
  ];
  const pack = [
    { id: 'wf-b', tier: 'reasoning', defaultApprovalMode: 'allow-durable-write', roleChain: ['security'] },
  ];
  const project = [
    { id: 'wf-a', tier: 'reasoning', defaultApprovalMode: 'requires-human-approval', roleChain: ['devil-advocate'] },
  ];

  const merged = mergeWorkflowManifests(builtin, pack, project);
  const wfA = merged.find((m) => m.id === 'wf-a');
  const wfB = merged.find((m) => m.id === 'wf-b');

  assert.equal(wfA.tier, 'reasoning');
  assert.equal(wfA.defaultApprovalMode, 'requires-human-approval');

  assert.equal(wfB.tier, 'reasoning');
  assert.equal(wfB.defaultApprovalMode, 'allow-durable-write');

  assert.equal(merged.length, 2);
});

test('loadAllWorkflows: loads and merges across tiers', () => {
  const dirs = resolveWorkflowManifestDirs();
  assert.ok(dirs.builtin.includes('lib/embedded-contract/workflows'));
  assert.ok(Array.isArray(dirs.pack));
  assert.ok(dirs.project.includes('.construct/workflows'));

  // Create a temp override workflow
  const tmpOverrideDir = mkdtempSync(join(tmpdir(), 'wf-cx-'));
  const projectOverrideDir = join(tmpOverrideDir, '.construct', 'workflows');
  mkdirSync(projectOverrideDir, { recursive: true });

  // Write an override for evidence-ingest
  writeFileSync(join(projectOverrideDir, 'evidence-ingest.manifest.json'), JSON.stringify({
    id: 'evidence-ingest',
    version: '2.0.0',
    type: 'linear',
    defaultApprovalMode: 'requires-human-approval',
    tier: 'reasoning',
    roleChain: ['security'],
    description: 'Overridden evidence ingest',
    owner: 'override-test',
    compatVersion: 1,
  }), 'utf8');

  const { workflows, errors } = loadAllWorkflows({ rootDir: tmpOverrideDir });
  assert.equal(errors.length, 0, `unexpected errors: ${errors.join(', ')}`);

  // evidence-ingest should now show the override
  const ei = workflows.find((w) => w.id === 'evidence-ingest');
  assert.ok(ei, 'evidence-ingest should be present');
  assert.equal(ei.defaultApprovalMode, 'requires-human-approval');
  assert.equal(ei.tier, 'reasoning');
  assert.equal(ei.roleChain[0], 'security');
  assert.equal(ei.version, '2.0.0');

  // non-overridden workflows should still be builtin
  const prd = workflows.find((w) => w.id === 'prd-draft');
  assert.ok(prd, 'prd-draft should be present');
  assert.equal(prd.defaultApprovalMode, 'proposal-only');

  // Cleanup
  rmSync(tmpOverrideDir, { recursive: true, force: true });
});