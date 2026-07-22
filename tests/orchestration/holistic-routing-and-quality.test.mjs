/**
 * tests/orchestration/holistic-routing-and-quality.test.mjs — pins tech-stack
 * entity filtering, explicit Worker Profile / team-chain recruitment, and the
 * output quality gate (em dashes + fabricated URLs) that backs prompt contracts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractNamedEntities,
  isTechStackEntity,
  detectExplicitWorkerProfile,
  detectTeamChain,
  requiresExternalResearch,
  routeRequest,
} from '../../lib/orchestration-policy.mjs';
import { gateOutputQuality } from '../../lib/orchestration/output-quality-gate.mjs';

test('tech-stack nouns are not named entities that force external research', () => {
  const request = 'Implement a Node.js Express API with Jest tests for CRUD todos';
  assert.equal(isTechStackEntity('Node'), true);
  assert.equal(isTechStackEntity('Express'), true);
  assert.deepEqual(extractNamedEntities(request), []);
  assert.equal(requiresExternalResearch({ request }).required, false);
});

test('product entities still force external research', () => {
  const request = 'evaluate whether to adopt Temporal for workflows';
  const gate = requiresExternalResearch({ request });
  assert.equal(gate.required, true);
  assert.equal(gate.reason, 'named-entities');
  assert.ok(extractNamedEntities(request).some((e) => /Temporal/i.test(e)));
});

test('explicit engineer Worker Profile leads; researcher is not stolen lead', () => {
  const request = 'As the engineer Worker Profile, implement a Node.js Express API with Jest. Do not invent URLs.';
  const route = routeRequest({ request });
  const ids = route.assignments.map((a) => a.workerProfileId);
  assert.equal(ids[0], 'engineer', `lead should be engineer, got ${ids.join(',')}`);
  assert.ok(!ids.includes('researcher') || ids.indexOf('engineer') < ids.indexOf('researcher'));
});

test('team chain architect then engineer then reviewer preserves order', () => {
  const request = 'Have architect then engineer then reviewer design and implement input validation';
  assert.deepEqual(detectTeamChain(request), ['architect', 'engineer', 'reviewer']);
  const route = routeRequest({ request });
  const ids = route.assignments.map((a) => a.workerProfileId);
  const a = ids.indexOf('architect');
  const e = ids.indexOf('engineer');
  const r = ids.indexOf('reviewer');
  assert.ok(a >= 0 && e >= 0 && r >= 0, `missing roles: ${ids.join(',')}`);
  assert.ok(a < e && e < r, `order broken: ${ids.join(',')}`);
});

test('explicit team chain excludes accessibility augmentation', () => {
  const request = 'Have architect then engineer then reviewer design input validation for a login form.';
  const route = routeRequest({ request });
  assert.deepEqual(
    route.assignments.map((assignment) => assignment.workerProfileId),
    ['architect', 'engineer', 'reviewer'],
  );
});

test('detectExplicitWorkerProfile recognizes common phrasings', () => {
  assert.equal(detectExplicitWorkerProfile('use the architect profile'), 'architect');
  assert.equal(detectExplicitWorkerProfile('as an engineer Worker Profile, ship it'), 'engineer');
  assert.equal(detectExplicitWorkerProfile('just refactor the parser'), null);
});

test('output quality gate flags em dashes', () => {
  const verdict = gateOutputQuality({
    output: 'Ship the fix — then verify tests.',
    workerProfileId: 'engineer',
    request: 'fix the bug',
  });
  assert.equal(verdict.ok, false);
  assert.ok(verdict.issues.some((i) => i.code === 'em-dash'));
});

test('output quality gate hard-fails fabricated URLs when request forbids inventing', () => {
  const verdict = gateOutputQuality({
    output: 'See https://example.com/made-up-docs for the API.',
    workerProfileId: 'engineer',
    request: 'Implement the API. Do not invent URLs.',
    webEvidence: [],
  });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.hardFail, true);
  assert.ok(verdict.issues.some((i) => i.code === 'fabricated-url'));
});

test('output quality gate allows localhost URLs inside fenced code', () => {
  const verdict = gateOutputQuality({
    output: 'Run the app with:\n```sh\ncurl http://localhost:3000/health\ncurl http://127.0.0.1:4000/status\n```',
    workerProfileId: 'engineer',
    request: 'Implement the API. Do not invent URLs.',
    webEvidence: [],
  });
  assert.equal(verdict.ok, true);
  assert.equal(verdict.hardFail, false);
});

test('output quality gate allows URLs backed by webEvidence', () => {
  const verdict = gateOutputQuality({
    output: 'Fetched https://example.com/docs on 2026-07-20.',
    workerProfileId: 'researcher',
    request: 'Research the docs. Do not invent URLs.',
    webEvidence: [{ url: 'https://example.com/docs' }],
  });
  assert.equal(verdict.ok, true);
});

test('routeRequest exposes advisoryAssignments without promoting them into assignmentSequence', () => {
  const route = routeRequest({
    request: 'Implement a caching layer with budget and ROI cost constraints',
    fileCount: 2,
    moduleCount: 1,
  });
  assert.ok(Array.isArray(route.advisoryAssignments), 'advisoryAssignments present');
  const advisoryIds = route.advisoryAssignments.map((a) => a.workerProfileId || a.workerProfile);
  const mandatoryIds = route.assignments.map((a) => a.workerProfileId);
  assert.ok(
    advisoryIds.includes('data-analyst') || advisoryIds.includes('product-manager'),
    `cost signal should advise finance-capable profile; got ${advisoryIds.join(',')}`,
  );
  for (const id of advisoryIds) {
    assert.ok(!mandatoryIds.includes(id), `advisory ${id} must not appear in mandatory assignments`);
  }
});

test('operations planning includes operations on orchestrated dependency sequencing', () => {
  const route = routeRequest({
    request: 'work out the dependency sequencing and rollout sequencing across module boundaries',
    fileCount: 1,
    moduleCount: 1,
  });
  const ids = route.assignments.map((a) => a.workerProfileId);
  assert.ok(ids.includes('operations'), `operations missing from ${ids.join(',')}`);
  assert.equal(route.track, 'orchestrated');
});

test('immediate Node/Express implementation assigns engineer and is not empty directExecution', () => {
  const route = routeRequest({
    request: 'Implement a Node.js Express API with Jest tests for CRUD todos',
    fileCount: 1,
    moduleCount: 1,
  });
  assert.equal(route.track, 'immediate');
  const ids = route.assignments.map((a) => a.workerProfileId);
  assert.ok(ids.includes('engineer'), `expected engineer; got ${ids.join(',') || '(empty)'}`);
  assert.equal(route.directExecution, false, 'engineer assignment means not empty directExecution');
});

test('immediate research with no assignments declares directExecution', () => {
  const route = routeRequest({
    request: 'explain how the caching layer works',
    fileCount: 1,
    moduleCount: 1,
  });
  assert.equal(route.track, 'immediate');
  assert.deepEqual(route.assignments, []);
  assert.equal(route.directExecution, true);
});

test('routeRequest attaches docAuthoringItems for multi-doc authoring requests', () => {
  const route = routeRequest({
    request: 'Draft a PRD and an ADR for the search ranking control plane',
    fileCount: 2,
    moduleCount: 1,
  });
  assert.ok(Array.isArray(route.docAuthoringItems), 'docAuthoringItems present');
  const types = route.docAuthoringItems.map((i) => i.docType);
  assert.ok(types.includes('prd') || types.includes('prd-platform'), `expected PRD type; got ${types.join(',')}`);
  assert.ok(types.includes('adr'), `expected ADR; got ${types.join(',')}`);
});

test('output quality gate hard-fails researcher URLs without webEvidence', () => {
  const verdict = gateOutputQuality({
    output: 'Fetched https://example.com/docs on 2026-07-20.',
    workerProfileId: 'researcher',
    request: 'Research the docs.',
    webEvidence: [],
  });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.hardFail, true);
  assert.ok(verdict.issues.some((i) => i.code === 'unverified-url'));
});
