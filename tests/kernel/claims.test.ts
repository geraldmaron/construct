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
