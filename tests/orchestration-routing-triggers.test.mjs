/**
 * tests/orchestration-routing-triggers.test.mjs — registry-driven routing
 * triggers (construct-uizpv.4).
 *
 * Snapshots the routing outputs isLegalComplianceRequest(),
 * flow-selection.mjs's Worker Profile selection, and detectRiskFlags() must
 * keep producing after the substrate/persona-leak refactor: the
 * legal-compliance keyword list and the flow-selection.mjs `['security']`
 * hardcode both moved into registry/routing-triggers.json, read through the
 * single generic evaluator in lib/orchestration/routing-triggers.mjs.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { isLegalComplianceRequest, detectRiskFlags } from '../lib/orchestration/classification.mjs';
import { selectWorkerProfiles, augmentWorkerProfiles, routeRequest } from '../lib/orchestration/flow-selection.mjs';
import {
  matchRoutingTriggers, focusedRoutingChain, routingTriggerFires,
  applyRoutingTriggerAugmentation, extraRiskFlags,
} from '../lib/orchestration/routing-triggers.mjs';
import { EXECUTION_TRACKS, INTENT_CLASSES } from '../lib/orchestration/policy-constants.mjs';

const LEGAL_PROBES = [
  'review GDPR compliance of our consent flow',
  'draft the SOC 2 attestation evidence pipeline',
  'what is our data processing agreement with this vendor',
];

test('isLegalComplianceRequest fires on every pre-refactor legal keyword probe', () => {
  for (const probe of LEGAL_PROBES) {
    assert.equal(isLegalComplianceRequest(probe), true, `expected legal-compliance match: ${probe}`);
  }
  assert.equal(isLegalComplianceRequest('write a short blog post about cats'), false);
});

test('routingTriggerFires("legal-compliance") agrees with isLegalComplianceRequest', () => {
  for (const probe of [...LEGAL_PROBES, 'write a short blog post about cats']) {
    assert.equal(routingTriggerFires('legal-compliance', probe), isLegalComplianceRequest(probe));
  }
});

test('matchRoutingTriggers resolves the legal-compliance trigger record with a security chain', () => {
  const [trigger] = matchRoutingTriggers('review GDPR compliance of our consent flow');
  assert.equal(trigger.id, 'legal-compliance');
  assert.deepEqual(trigger.chain, ['security']);
  assert.equal(trigger.position, 'prepend');
});

test('focusedRoutingChain replaces the old flow-selection.mjs hardcoded return', () => {
  assert.deepEqual(focusedRoutingChain('review GDPR compliance of our consent flow'), ['security']);
  assert.equal(focusedRoutingChain('write a short blog post about cats'), null);
});

test('selectWorkerProfiles: focused track dispatches security on legal-compliance keyword (pre-refactor snapshot)', () => {
  const profiles = selectWorkerProfiles({
    request: 'review GDPR compliance of our consent flow',
    intent: INTENT_CLASSES.evaluation,
    track: EXECUTION_TRACKS.focused,
  });
  assert.deepEqual(profiles, ['security']);
});

test('applyRoutingTriggerAugmentation prepends security ahead of architect (pre-refactor snapshot)', () => {
  const augmented = applyRoutingTriggerAugmentation(['architect', 'engineer'], 'build the SOC 2 attestation evidence pipeline end to end');
  assert.deepEqual(augmented, ['security', 'architect', 'engineer']);
});

test('augmentWorkerProfiles prepends security pre-architect on legal-compliance request (pre-refactor snapshot)', () => {
  const list = augmentWorkerProfiles(['architect', 'engineer', 'reviewer', 'qa'], {
    request: 'build the SOC 2 attestation evidence pipeline end to end',
  });
  assert.ok(list.includes('security'));
  assert.ok(list.indexOf('security') < list.indexOf('architect'));
});

test('routeRequest: full legal-compliance route is unchanged end to end (pre-refactor snapshot)', () => {
  const focused = routeRequest({ request: 'review GDPR compliance of our consent flow', fileCount: 1, moduleCount: 1 });
  assert.equal(focused.track, EXECUTION_TRACKS.focused);
  assert.deepEqual(focused.assignments.map((a) => a.workerProfileId), ['security']);

  const orchestrated = routeRequest({ request: 'build the SOC 2 attestation evidence pipeline end to end', fileCount: 4, moduleCount: 2 });
  assert.equal(orchestrated.track, EXECUTION_TRACKS.orchestrated);
  const ids = orchestrated.assignments.map((a) => a.workerProfileId);
  assert.ok(ids.includes('security'));
  assert.ok(ids.indexOf('security') < ids.indexOf('architect'));
});

test('detectRiskFlags: fixed enum keys are unaffected and stay boolean (pre-refactor snapshot)', () => {
  const flags = detectRiskFlags('design our terraform agent strategy with blast radius controls, OIDC credential handling, and a phased production rollout');
  assert.equal(flags.architecture, true);
  assert.equal(flags.security, true);
  assert.equal(flags.dataIntegrity, false);
});

test('extraRiskFlags is empty by default (canonical registry declares no riskFlagDimensions)', () => {
  assert.deepEqual(extraRiskFlags('anything at all'), {});
});
