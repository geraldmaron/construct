/**
 * tests/artifact-workflow.test.mjs — manifest intent planning and run provenance.
 *
 * Planner ordering and report truthfulness remain deterministic across hosts.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { planArtifactWorkflow, runArtifactWorkflow } from '../lib/artifact-workflow.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('plans review before rewrite and branded customer PDF from a PRD request', () => {
  const plan = planArtifactWorkflow({
    input: 'Review this PRD, rewrite it, and create a customer PDF.',
  }, { rootDir: REPO, cwd: REPO });
  assert.equal(plan.status, 'planned');
  assert.equal(plan.target.format, 'pdf');
  assert.equal(plan.target.branding, 'construct');
  assert.equal(plan.target.audience, 'customer');
  assert.ok(plan.plannedSteps.findIndex((step) => step.id === 'review') < plan.plannedSteps.findIndex((step) => step.id === 'rewrite'));
  assert.ok(plan.plannedSteps.findIndex((step) => step.id === 'rewrite') < plan.plannedSteps.findIndex((step) => step.id === 'validate'));
  assert.ok(plan.plannedSteps.findIndex((step) => step.id === 'validate') < plan.plannedSteps.findIndex((step) => step.id === 'export'));
});

test('plans a non-core registered class without a hardcoded PRD/RFC/ADR list', () => {
  const plan = planArtifactWorkflow({ input: 'Review and rewrite the runbook as HTML.' }, { rootDir: REPO, cwd: REPO });
  assert.equal(plan.status, 'planned');
  assert.equal(plan.artifactType, 'runbook');
  assert.equal(plan.target.format, 'html');
});

test('honors an explicit plain-output request over default branding', () => {
  const plan = planArtifactWorkflow({ input: 'Create an unbranded ADR PDF.' }, { rootDir: REPO, cwd: REPO });
  assert.equal(plan.status, 'planned');
  assert.equal(plan.target.branding, 'plain');
  assert.equal(plan.plannedSteps.some((step) => step.id === 'brand'), false);
});

test('requires clarification for ambiguous or unclassified artifact requests', () => {
  const plan = planArtifactWorkflow({ input: 'Review this document and make it better.' }, { rootDir: REPO, cwd: REPO });
  assert.equal(plan.status, 'needs-classification');
  assert.match(plan.clarification, /Specify a registered document class/i);
});

test('run report is stable and never claims planned specialist work executed in a prompt-only host', () => {
  const request = { input: 'Review and rewrite this ADR as a customer PDF.' };
  const first = runArtifactWorkflow(request, { rootDir: REPO, cwd: REPO });
  const second = runArtifactWorkflow(request, { rootDir: REPO, cwd: REPO });
  assert.deepEqual(first, second);
  assert.deepEqual(first.executedSteps, []);
  assert.ok(first.skippedSteps.some((step) => step.id === 'review'));
  assert.ok(first.skippedSteps.some((step) => step.id === 'rewrite'));
  assert.equal(first.producedFiles.length, 0);
});

test('durable approval still marks specialist work skipped without host evidence', () => {
  const report = runArtifactWorkflow({
    input: 'Review and rewrite this runbook as HTML.',
    approvalMode: 'allow-durable-write',
  }, { rootDir: REPO, cwd: REPO });
  assert.equal(report.approval.durableWriteAllowed, true);
  assert.ok(report.skippedSteps.some((step) => step.id === 'review' && /host-owned/.test(step.reason)));
  assert.ok(report.skippedSteps.some((step) => step.id === 'export' && /sourcePath/.test(step.reason)));
});
