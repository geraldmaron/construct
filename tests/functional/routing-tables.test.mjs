/**
 * tests/functional/routing-tables.test.mjs — parity guard for declarative routing.
 *
 * Loads the real registry via routing-tables.mjs and asserts
 * each route the orchestration layer depends on. Catches drift if a future
 * registry edit drops a subscription, mis-names a watcher, or strips an
 * artifact owner.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ownerForEvent,
  ownerForDoc,
  evaluateWatchConditions,
  knownEventTypes,
  knownDocTypes,
  knownWatchers,
} from '../../lib/orchestration/routing-tables.mjs';

// A consolidation reduced the 29-specialist roster to 12 (orchestrator
// + 11 workers); owners below reflect that roster (e.g. sre/release-manager/
// docs-keeper folded into operations — see the appendix addendum).
const EXPECTED_EVENTS = {
  'push_gate.fail': 'operations',
  'service.down': 'operations',
  'mcp.unhealthy.persistent': 'operations',
  'edit_loop.stuck': 'operations',
  'test.fail': 'qa',
  'test.flake': 'qa',
  'coverage.drop': 'qa',
  'dep.cve': 'security',
  'secrets.detected': 'security',
  'config.protection.violation': 'security',
  'pr.merged.no-docs': 'operations',
  'changelog.missing': 'operations',
  'document.stale': 'operations',
  'readme.stale': 'operations',
  'adr.requested': 'architect',
  'arch.boundary.violated': 'architect',
  'regression.detected': 'debugger',
  'hang.detected': 'debugger',
  'release.candidate': 'operations',
  'version.bump.needed': 'operations',
  'backlog.stale': 'product-manager',
  'prd.requested': 'product-manager',
  'pr.opened': 'reviewer',
  'pr.ready-for-review': 'reviewer',
  'infra.change.requested': 'engineer',
  'service.scale.event': 'engineer',
  'design.requested': 'designer',
  'a11y.violation': 'designer',
  'research.requested': 'researcher',
  'evidence.requested': 'researcher',
  'eval.regression': 'reviewer',
  'trace.anomaly': 'reviewer',
  'dep.license': 'security',
  'privacy-policy.review': 'security',
  'strategy.required': 'product-manager',
  'plan.requested': 'operations',
  'research.gate.required': 'architect',
  'handoff.received': 'orchestrator',
  'incident.handoff': 'engineer',
  'bug.assigned': 'engineer',
  'feature.assigned': 'engineer',
};

const EXPECTED_DOCS = {
  prd: 'product-manager',
  'meta-prd': 'product-manager',
  'prd-platform': 'product-manager',
  'prd-business': 'product-manager',
  prfaq: 'product-manager',
  'one-pager': 'product-manager',
  'backlog-proposal': 'product-manager',
  'customer-profile': 'product-manager',
  adr: 'architect',
  rfc: 'architect',
  'rfc-platform': 'architect',
  'architecture-overview': 'architect',
  'system-design': 'architect',
  'research-brief': 'researcher',
  'evidence-brief': 'researcher',
  'signal-brief': 'researcher',
  'product-intelligence-report': 'researcher',
  runbook: 'operations',
  'incident-report': 'operations',
  postmortem: 'operations',
  'test-plan': 'qa',
  'qa-strategy': 'qa',
  'security-review': 'security',
  'threat-model': 'security',
  memo: 'operations',
  changelog: 'operations',
  strategy: 'product-manager',
};

test('every expected event resolves to its declared specialist owner', () => {
  for (const [event, owner] of Object.entries(EXPECTED_EVENTS)) {
    assert.equal(ownerForEvent(event), owner, `event ${event}`);
  }
});

test('every expected doc artifact resolves to its declared specialist owner', () => {
  for (const [docType, owner] of Object.entries(EXPECTED_DOCS)) {
    assert.equal(ownerForDoc(docType), owner, `doc ${docType}`);
  }
});

test('unknown event types return null instead of throwing', () => {
  assert.equal(ownerForEvent('does-not-exist.event'), null);
  assert.equal(ownerForEvent(''), null);
  assert.equal(ownerForEvent(null), null);
});

test('unknown doc types return null instead of throwing', () => {
  assert.equal(ownerForDoc('not-a-real-doc-type'), null);
  assert.equal(ownerForDoc(''), null);
});

test('wide blast radius triggers operations via watch condition', () => {
  const triggers = evaluateWatchConditions({
    blastRadius: 'wide',
    riskFlags: {},
  });
  const operations = triggers.find((t) => t.workerProfile === 'operations');
  assert.ok(operations, 'expected operations triggered by wide-blast-radius');
  assert.equal(operations.watcher, 'wide-blast-radius');
});

test('auth + non-narrow blast triggers security via watch condition', () => {
  const triggers = evaluateWatchConditions({
    authOrPayments: true,
    blastRadius: 'wide',
    riskFlags: {},
  });
  const security = triggers.find((t) => t.workerProfile === 'security');
  assert.ok(security, 'expected security triggered by auth-payments-non-narrow');
  assert.match(security.reason, /auth|payments|threat/i);
});

test('high ambiguity on deep work triggers product-manager via watch condition', () => {
  const triggers = evaluateWatchConditions({
    ambiguityScore: 0.7,
    workCategory: 'deep',
    riskFlags: {},
    blastRadius: 'narrow',
  });
  const pm = triggers.find((t) => t.workerProfile === 'product-manager');
  assert.ok(pm, 'expected product-manager triggered by high-ambiguity-deep-work');
});

test('narrow scope with no signals returns no triggers', () => {
  const triggers = evaluateWatchConditions({
    ambiguityScore: 0,
    workCategory: 'quick',
    riskFlags: {},
    blastRadius: 'narrow',
    hasSuccessMetric: true,
    authOrPayments: false,
    visualDeliverable: false,
  });
  assert.equal(triggers.length, 0);
});

test('registry covers the full set of routable event types', () => {
  const events = knownEventTypes();
  assert.equal(events.length, Object.keys(EXPECTED_EVENTS).length);
});

test('registry covers the full set of routable doc artifact types', () => {
  const docs = knownDocTypes();
  assert.equal(docs.length, Object.keys(EXPECTED_DOCS).length);
});

test('all seven registry-declared watch conditions are known', () => {
  const watchers = knownWatchers();
  assert.deepEqual(watchers.sort(), [
    'architecture-risk',
    'architecture-without-metric',
    'auth-payments-non-narrow',
    'high-ambiguity-deep-work',
    'named-cost-constraint',
    'visual-or-ui-risk',
    'wide-blast-radius',
  ].sort());
});
