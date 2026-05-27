/**
 * tests/intake-classifier-accuracy.test.mjs — Accuracy and determinism guard
 * for `lib/intake/classify.mjs#classifyRdIntake`.
 *
 * Covers the failure modes that motivated the rewrite:
 *   - Postmortems are not bug reports (title-level negative keyword wins).
 *   - Filename intent signals are honored (e.g. `-bug.txt` routes to bug).
 *   - A research note that mentions "outage" once is not an incident.
 *   - Security and architecture filename hints route correctly.
 *   - The same input produces the same output across repeated calls.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyRdIntake } from '../lib/intake/classify.mjs';

test('postmortem document classifies as incident, not bug', () => {
  const triage = classifyRdIntake({
    sourcePath: 'inbox/postmortem-feb-outage.md',
    extractedText: [
      '# Postmortem: February outage',
      '',
      'A 47-minute incident on the payments API. SLO breach on availability.',
      'Pagerduty paged oncall at 02:14. The crash repeated until rollback.',
      'Error rates spiked to 30 percent before failover.',
    ].join('\n'),
  });
  assert.equal(triage.intakeType, 'incident');
  assert.notEqual(triage.intakeType, 'bug');
  assert.equal(triage.primaryOwner, 'sre');
});

test('bug report by filename suffix routes to bug', () => {
  const triage = classifyRdIntake({
    sourcePath: 'inbox/payment-checkout-bug.txt',
    extractedText: 'Bug: checkout throws an exception when the cart is empty.',
  });
  assert.equal(triage.intakeType, 'bug');
  assert.equal(triage.primaryOwner, 'debugger');
});

test('research note that mentions outage once is not an incident', () => {
  const triage = classifyRdIntake({
    sourcePath: 'inbox/competitor-pricing-study.md',
    extractedText: [
      'Industry benchmark study on competitor pricing and positioning.',
      'One vendor reportedly had a brief outage last quarter but it is not material here.',
      'The literature on state of the art pricing models suggests a tiered approach.',
    ].join('\n'),
  });
  assert.notEqual(triage.intakeType, 'incident');
  assert.ok(
    ['research', 'user-signal'].includes(triage.intakeType),
    `expected research or user-signal, got ${triage.intakeType}`,
  );
});

test('security scan finding routes to security', () => {
  const triage = classifyRdIntake({
    sourcePath: 'inbox/security-scan-findings.md',
    extractedText: 'CVE-2024-12345 reported in dependency foo. Possible RCE via untrusted input.',
  });
  assert.equal(triage.intakeType, 'security');
  assert.equal(triage.requiresApproval, true);
});

test('ADR filename routes to architecture', () => {
  const triage = classifyRdIntake({
    sourcePath: 'docs/adr/adr-0001-service-boundary.md',
    extractedText: 'Context: we need to pick a service boundary for the payments domain.',
  });
  assert.equal(triage.intakeType, 'architecture');
  assert.equal(triage.primaryOwner, 'architect');
});

test('PRD filename routes to requirement', () => {
  const triage = classifyRdIntake({
    sourcePath: 'docs/prd/prd-checkout-v2.md',
    extractedText: 'Acceptance criteria: must support guest checkout. Success metric: conversion +5pp.',
  });
  assert.equal(triage.intakeType, 'requirement');
});

test('classification is deterministic across repeated calls', () => {
  const input = {
    sourcePath: 'inbox/postmortem-feb-outage.md',
    extractedText: [
      '# Postmortem: February outage',
      'SLO breach on availability. The crash repeated until rollback.',
    ].join('\n'),
  };
  const baseline = classifyRdIntake(input);
  for (let i = 0; i < 10; i++) {
    const triage = classifyRdIntake(input);
    assert.deepEqual(triage, baseline, `run ${i + 1} drifted from baseline`);
  }
});

test('ambiguous tie drops confidence to 0.5 or below', () => {
  // user-signal hits: customer, feedback. requirement hits: feature request,
  // must have. Both land at exactly two hits, so the margin is zero and the
  // confidence should be capped at 0.5.
  const triage = classifyRdIntake({
    sourcePath: 'inbox/note.md',
    extractedText: 'Customer feedback notes. Feature request: must have a way to filter.',
  });
  assert.ok(
    triage.confidence <= 0.5,
    `expected confidence <= 0.5 on ambiguous input, got ${triage.confidence} (type=${triage.intakeType})`,
  );
});

test('unrelated text falls through to unknown', () => {
  const triage = classifyRdIntake({
    sourcePath: 'inbox/random.md',
    extractedText: 'something completely unrelated to any taxonomy term whatsoever',
  });
  assert.equal(triage.intakeType, 'unknown');
});
