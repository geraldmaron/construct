/**
 * tests/certification/p2-surface-harness.test.mjs — P2 certification surface harnesses.
 *
 * @capability test-system.certification-runner
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateAllPerspectives } from '../../lib/certification/perspectives.mjs';
import { measurePromptBudgetChains } from '../../lib/certification/prompt-budget.mjs';
import { validateAllArtifactProvenance } from '../../lib/certification/artifact-provenance.mjs';
import { validateDocumentWorkflowCertification } from '../../lib/certification/document-workflow.mjs';
import { buildDemoParityReport } from '../../lib/certification/demo-parity.mjs';
import { buildVisualParityReport } from '../../lib/certification/visual-parity.mjs';
import { persistDemoState } from '../../lib/demo-state.mjs';
import { realLlmSkipReason } from '../../lib/certification/real-llm-scenarios.mjs';
import { listScenarios } from '../../lib/certification/scenarios.mjs';
import { runCertificationScenario } from '../../lib/certification/runner.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('perspective parity passes for the shipped catalog', () => {
  const result = validateAllPerspectives({ rootDir: REPO });
  assert.equal(result.pass, true, result.errors.join('\n'));
  assert.ok(result.perspectiveClassCoverage.includes('architect'));
  assert.ok(result.perspectiveClassCoverage.includes('qa'));
});

test('prompt budget chains stay within active profile limits', () => {
  const result = measurePromptBudgetChains({ rootDir: REPO });
  assert.equal(result.pass, true, result.errors.join('\n'));
  assert.ok(result.chains.length >= 3);
});

test('artifact provenance and accessibility checks pass on golden fixtures', () => {
  const result = validateAllArtifactProvenance({ rootDir: REPO, strict: true });
  assert.equal(result.pass, true, result.errors.slice(0, 5).join('\n'));
});

test('document workflow certification covers pdf and docx intake', () => {
  const result = validateDocumentWorkflowCertification({ rootDir: REPO });
  assert.equal(result.pass, true, result.errors.join('\n'));
  const ids = result.scenarios.map((s) => s.categoryId);
  assert.ok(ids.includes('pdf'));
  assert.ok(ids.includes('word'));
});

test('visual parity report passes for diagram surfaces', () => {
  const report = buildVisualParityReport({ rootDir: REPO });
  assert.equal(report.pass, true, JSON.stringify(report.mismatches, null, 2));
});

test('demo parity report passes for canonical demos', () => {
  const stateCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-parity-p2-'));
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
  assert.equal(report.pass, true);
  assert.ok(report.acceptableDivergences.length >= 1);
  assert.equal(report.stateAware, true);
});

test('catalog includes P2 hermetic scenario ids', () => {
  const ids = new Set(listScenarios({ repoRoot: REPO }).map((s) => s.id));
  for (const id of [
    'worker-profile.perspectives',
    'skills.prompt-budget',
    'artifact.provenance',
    'document.workflow.roundtrip',
    'demo.parity.surfaces',
    'visual.parity.surface',
    'real-llm.s3',
    'real-llm.s8',
  ]) {
    assert.ok(ids.has(id), `missing scenario ${id}`);
  }
});

test('hermetic P2 scenarios pass via certification runner', async (t) => {
  const rootDir = path.join(REPO, '.tmp', `cert-p2-${Date.now()}`);
  fs.mkdirSync(path.join(rootDir, '.construct', 'certification', 'runs'), { recursive: true });
  fs.mkdirSync(path.join(rootDir, '.construct', 'demos', 'state'), { recursive: true });
  for (const id of [
    'agentic-platforms-prd',
    'construct-cockpit',
    'architecture-review-adr',
    'capability-contract',
    'intake-triage',
    'profile-doctor-health',
  ]) {
    persistDemoState(id, { cwd: rootDir, state: 'verified', enforceTransition: false });
  }
  t.after(() => fs.rmSync(rootDir, { recursive: true, force: true }));

  for (const scenarioId of [
    'worker-profile.perspectives',
    'skills.prompt-budget',
    'artifact.provenance',
    'document.workflow.roundtrip',
    'demo.parity.surfaces',
    'visual.parity.surface',
  ]) {
    const result = await runCertificationScenario(scenarioId, { projectDir: rootDir, repoRoot: REPO });
    assert.equal(result.run.verdict.status, 'pass', `${scenarioId}: ${result.run.verdict.reason ?? ''}`);
  }
});

test('real-llm scenarios skip without opt-in', async (t) => {
  const env = { ...process.env };
  delete env.CONSTRUCT_CERTIFY_LIVE;
  delete env.CONSTRUCT_E2E_REAL_LLM;
  assert.ok(realLlmSkipReason(env));
  const fs = await import('node:fs');
  const os = await import('node:os');
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cert-real-llm-skip-'));
  t.after(() => fs.rmSync(rootDir, { recursive: true, force: true }));
  const s3 = await runCertificationScenario('real-llm.s3', { projectDir: rootDir, repoRoot: REPO, env });
  assert.equal(s3.run.verdict.status, 'inconclusive');
});
