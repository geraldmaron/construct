/**
 * tests/kernel/workflow/validators-gates.test.ts — verification, review, and
 * plan validators fail closed on empty, null, old, or unresolved evidence.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runValidators } from '../../../src/kernel/workflow/validators.ts';

const empty = { expectedKeys: [] as string[], evidence: [] as { ref: string }[], resolvableRefs: new Set<string>() };

test('verification_result refuses failed, empty, null, and old-revision evidence', () => {
  assert.equal(runValidators(['verification_result'], { ...empty, output: { passed: false } })[0]!.ok, false);
  assert.equal(runValidators(['verification_result'], { ...empty, output: { artifact: null, passed: true } })[0]!.ok, false);
  assert.equal(runValidators(['verification_result'], { ...empty, output: { result: '   ' } })[0]!.ok, false);
  assert.equal(runValidators(['verification_result'], { ...empty, output: { exitStatus: 1, passed: true } })[0]!.ok, false);
  assert.equal(runValidators(['verification_result'], { ...empty, output: { revision: 'old', passed: true } })[0]!.ok, false);
  assert.equal(runValidators(['verification_result'], { ...empty, output: { passed: true, unresolved: ['x'] } })[0]!.ok, false);
  assert.equal(runValidators(['verification_result'], { ...empty, output: { command: 'npm test', exitStatus: 0, passed: true, revision: 'abc' } })[0]!.ok, true);
});

test('review_complete refuses empty findings and unresolved required items', () => {
  assert.equal(runValidators(['review_complete'], { ...empty, output: { subject: 'x' } })[0]!.ok, false);
  assert.equal(runValidators(['review_complete'], { ...empty, output: { subject: 'x', subjectRevision: '1', method: 'adversarial', findings: [{ required: true, disposition: 'open' }] } })[0]!.ok, false);
  assert.equal(runValidators(['review_complete'], { ...empty, output: { subject: 'x', subjectRevision: '1', reviewer: 'a', findings: [], disposition: 'no_findings' } })[0]!.ok, true);
});

test('plan_complete refuses missing scope and unresolved blockers', () => {
  assert.equal(runValidators(['plan_complete'], { ...empty, output: { outcome: 'ship' } })[0]!.ok, false);
  assert.equal(runValidators(['plan_complete'], { ...empty, output: { outcome: 'ship', scope: 'here', nonGoals: 'not that', premises: [], acceptance: 'tests', blockers: ['no owner'], ready: true } })[0]!.ok, false);
  assert.equal(runValidators(['plan_complete'], { ...empty, output: { outcome: 'ship', scope: 'here', nonGoals: 'not that', premises: [], acceptance: 'tests', ready: true } })[0]!.ok, true);
});
