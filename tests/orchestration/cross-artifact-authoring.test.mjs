/**
 * tests/orchestration/cross-artifact-authoring.test.mjs — cross-artifact authoring
 * verbs, semantic PRD subtypes, and multi-doc detectDocAuthoringItems coverage.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  detectDocAuthoringIntent,
  detectDocAuthoringItems,
  refineDocAuthoringSubtype,
} from '../../lib/orchestration-policy.mjs';

test('synthesize verb detects ADR authoring intent', () => {
  const request = 'Synthesize an ADR for the new control-plane boundary';
  const intent = detectDocAuthoringIntent(request);
  assert.equal(intent?.docType, 'adr');
  assert.ok(intent?.owner);
});

test('synthesize verb detects PRD authoring intent', () => {
  const request = 'Please synthesize a PRD for workspace onboarding';
  const intent = detectDocAuthoringIntent(request);
  assert.equal(intent?.docType, 'prd');
  assert.ok(intent?.owner);
});

test('synthesize verb detects research-brief authoring intent', () => {
  const request = 'Synthesizing a research brief on competitor packaging';
  const intent = detectDocAuthoringIntent(request);
  assert.equal(intent?.docType, 'research-brief');
  assert.ok(intent?.owner);
});

test('compile verb detects typed document authoring when doc type is present', () => {
  const request = 'Compile a runbook for the tenant migration cutover';
  const intent = detectDocAuthoringIntent(request);
  assert.equal(intent?.docType, 'runbook');
  assert.ok(intent?.owner);
});

test('compile alone without a doc type does not infer authoring intent', () => {
  assert.equal(detectDocAuthoringIntent('Compile the TypeScript project'), null);
});

test('control-plane signals refine generic PRD to prd-platform', () => {
  const request = 'Draft a PRD for the control-plane API and SDK tenant model';
  assert.equal(refineDocAuthoringSubtype('prd', request), 'prd-platform');
  assert.equal(detectDocAuthoringIntent(request)?.docType, 'prd-platform');
});

test('pricing and packaging signals refine generic PRD to prd-business', () => {
  const request = 'Write a PRD covering pricing and packaging for the billing model';
  assert.equal(refineDocAuthoringSubtype('prd', request), 'prd-business');
  assert.equal(detectDocAuthoringIntent(request)?.docType, 'prd-business');
});

test('detectDocAuthoringItems returns PRD and ADR for multi-type requests', () => {
  const request = 'Draft a PRD and ADR for the workspace preset rollout';
  const items = detectDocAuthoringItems(request);
  assert.equal(items.length, 2);
  assert.deepEqual(
    items.map((item) => item.docType).sort(),
    ['adr', 'prd'],
  );
  assert.ok(items.every((item) => item.owner));
});

test('detectDocAuthoringIntent stays first-match compatible for multi-type requests', () => {
  const request = 'Draft a PRD and ADR for the workspace preset rollout';
  assert.equal(detectDocAuthoringIntent(request)?.docType, 'adr');
});

test('detectDocAuthoringItems deduplicates refined PRD subtypes', () => {
  const request = 'Draft a platform PRD for the tenant SDK API';
  const items = detectDocAuthoringItems(request);
  assert.equal(items.length, 1);
  assert.equal(items[0]?.docType, 'prd-platform');
});
