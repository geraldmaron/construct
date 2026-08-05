import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findUntaggedClaims } from '../../src/kernel/verify/claims.ts';

test('flags a dollar figure with no citation or unverified tag', () => {
  const findings = findUntaggedClaims('Revenue grew to $4.2M last quarter.');
  assert.equal(findings.length, 1);
});

test('accepts a claim with a citation marker', () => {
  const findings = findUntaggedClaims('Revenue grew to $4.2M last quarter. [cite:q3-report.pdf]');
  assert.equal(findings.length, 0);
});

test('accepts a claim explicitly tagged unverified', () => {
  const findings = findUntaggedClaims('Adoption is roughly 40% of the target market. [unverified]');
  assert.equal(findings.length, 0);
});

test('ignores prose with no load-bearing claim shape', () => {
  const findings = findUntaggedClaims('The team met on Tuesday to discuss scope.');
  assert.equal(findings.length, 0);
});

// The statute and duration fixtures below are the recorded first-run
// simulation deliverable's own phrasing, not text written to fit the matcher.

test('flags an uncited statute reference in the recorded art.-plus-section form', () => {
  const findings = findUntaggedClaims(
    'Employee status follows from Polish Labour Code art. 22 §1(1).',
  );
  assert.equal(findings.length, 1);
});

test('flags an uncited plural arts. reference', () => {
  const findings = findUntaggedClaims('Moral rights are governed by Copyright Act arts. 41/43.');
  assert.equal(findings.length, 1);
});

test('flags an uncited directive number', () => {
  const findings = findUntaggedClaims('Late-payment interest accrues under Directive 2011/7.');
  assert.equal(findings.length, 1);
});

test('flags an uncited numeric duration', () => {
  const findings = findUntaggedClaims('The breach must be reported within 72 hours of awareness.');
  assert.equal(findings.length, 1);
});

test('accepts a statute reference with a citation marker', () => {
  const findings = findUntaggedClaims(
    'Processing obligations flow down under GDPR art. 28. [cite:gdpr-art-28]',
  );
  assert.equal(findings.length, 0);
});

test('does not flag bare spelled-out quantities — those belong to the substantive pass', () => {
  const findings = findUntaggedClaims(
    'The licence covers three of the five fields of exploitation.',
  );
  assert.equal(findings.length, 0);
});
