/**
 * agent-contracts.test.mjs — Runtime contract-chain enforcement tests.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveContractChain, validatePacket } from '../lib/agent-contracts.mjs';
import { EXECUTION_TRACKS, INTENT_CLASSES, WORK_CATEGORIES, routeRequest } from '../lib/orchestration-policy.mjs';

test('resolveContractChain excludes handoffs whose participants are not scheduled', () => {
  const chain = resolveContractChain({
    intent: INTENT_CLASSES.research,
    workCategory: WORK_CATEGORIES.quick,
    track: EXECUTION_TRACKS.immediate,
    specialists: [],
    riskFlags: {},
  });

  assert.deepEqual(chain.map((entry) => entry.contract.id), ['user-to-construct']);
});

test('routeRequest exposes only runnable contracts for immediate requests', () => {
  const route = routeRequest({
    request: 'explain how the caching layer works',
    fileCount: 1,
    moduleCount: 1,
  });

  assert.equal(route.track, EXECUTION_TRACKS.immediate);
  assert.deepEqual(route.contractChain.map((entry) => entry.contract.id), ['user-to-construct']);
});

test('routeRequest includes engineer review and QA contracts only when those agents are scheduled', () => {
  const route = routeRequest({
    request: 'build this feature end to end and ship it',
    fileCount: 4,
    moduleCount: 2,
  });

  const ids = route.contractChain.map((entry) => entry.contract.id);
  assert.ok(ids.includes('engineer-to-reviewer'));
  assert.ok(ids.includes('engineer-to-qa'));
});

test('validatePacket enforces required non-empty fields', () => {
  const result = validatePacket('architect-to-engineer', {
    goal: 'Harden contracts',
    approach: '',
    tasks: ['add validators'],
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.missing, ['approach', 'acceptanceCriteria']);
});

test('reviewer postcondition requires findings OR explicit no-issues enumeration', () => {
  const empty = validatePacket('engineer-to-reviewer', { verdict: 'APPROVED' }, 'output');
  assert.equal(empty.ok, false);
  assert.ok(empty.missing.includes('findings|noIssuesFoundAt'));

  const withFindings = validatePacket('engineer-to-reviewer', { verdict: 'APPROVED', findings: ['style nit at foo.ts:42'] }, 'output');
  assert.equal(withFindings.ok, true);

  const withExplicitNone = validatePacket('engineer-to-reviewer', { verdict: 'APPROVED', noIssuesFoundAt: ['lib/foo.mjs', 'lib/bar.mjs'] }, 'output');
  assert.equal(withExplicitNone.ok, true);
});

test('reviewer verdict must match the enum', () => {
  const bad = validatePacket('engineer-to-reviewer', { verdict: 'LGTM', findings: ['x'] }, 'output');
  assert.equal(bad.ok, false);
  assert.ok(bad.missing.some((m) => m.startsWith('verdict!=')));
});

test('debugger postcondition requires confirmed root-cause provenance', () => {
  const noConfirmation = validatePacket('any-to-debugger', { rootCause: 'race condition', fix: 'add mutex' }, 'output');
  assert.equal(noConfirmation.ok, false);
  assert.ok(noConfirmation.missing.includes('rootCauseConfirmedVia'));

  const symptomOnly = validatePacket('any-to-debugger', { rootCause: 'flaky test', rootCauseConfirmedVia: 'guess', fix: 'retry' }, 'output');
  assert.equal(symptomOnly.ok, false);
  assert.ok(symptomOnly.missing.some((m) => m.startsWith('rootCauseConfirmedVia!=')));

  const confirmed = validatePacket('any-to-debugger', { rootCause: 'flaky test', rootCauseConfirmedVia: 'reproduction', fix: 'retry' }, 'output');
  assert.equal(confirmed.ok, true);
});

test('designer postcondition requires accessibility check ran', () => {
  const noA11y = validatePacket('any-to-designer', { deliverable: 'mockup.png' }, 'output');
  assert.equal(noA11y.ok, false);
  assert.ok(noA11y.missing.includes('accessibilityCheckRan'));

  const withA11y = validatePacket('any-to-designer', { deliverable: 'mockup.png', accessibilityCheckRan: true }, 'output');
  assert.equal(withA11y.ok, true);
});

test('docs-keeper postcondition requires a coherence diff', () => {
  const noDiff = validatePacket('any-to-docs-keeper', { updatedDocs: ['CHANGELOG.md'], crossReferencesAdded: [] }, 'output');
  assert.equal(noDiff.ok, false);
  assert.ok(noDiff.missing.includes('crossDocCoherenceCheckRan'));
  assert.ok(noDiff.missing.includes('coherenceDiff'));

  const withDiff = validatePacket('any-to-docs-keeper', {
    updatedDocs: ['CHANGELOG.md'],
    crossReferencesAdded: ['docs/concepts/architecture.md'],
    crossDocCoherenceCheckRan: true,
    coherenceDiff: 'CHANGELOG bullet aligns with architecture.md service-manager paragraph',
  }, 'output');
  assert.equal(withDiff.ok, true);
});
