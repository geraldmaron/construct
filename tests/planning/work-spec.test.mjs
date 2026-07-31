/**
 * tests/planning/work-spec.test.mjs — Work spec schema.
 *
 * Pure, no I/O: validateWorkSpec/validateAssignment never throw and return
 * error strings; createWorkSpec fills defaults without mutating the input.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createWorkSpec, validateWorkSpec, validateAssignment, ASSIGNMENT_KINDS } from '../../lib/planning/work-spec.mjs';

function validAssignment(overrides = {}) {
  return {
    id: 'a1',
    kind: 'execute',
    touches: ['file:lib/a.mjs'],
    dependsOn: [],
    ownership: { files: ['lib/a.mjs'] },
    ...overrides,
  };
}

function validSpec(overrides = {}) {
  return {
    objective: 'Ship the thing',
    desiredOutcome: 'The thing ships',
    dependencyRationale: 'a1 and a2 touch disjoint files',
    ownership: { files: ['lib/**'] },
    decomposition: [validAssignment(), validAssignment({ id: 'a2', touches: ['file:lib/b.mjs'], ownership: { files: ['lib/b.mjs'] } })],
    ...overrides,
  };
}

test('validateAssignment accepts a well-formed assignment', () => {
  assert.deepEqual(validateAssignment(validAssignment()), []);
});

test('validateAssignment rejects a missing id', () => {
  const errors = validateAssignment(validAssignment({ id: undefined }));
  assert.ok(errors.some((e) => e.includes('.id:')));
});

test('validateAssignment rejects an unknown kind', () => {
  const errors = validateAssignment(validAssignment({ kind: 'nope' }));
  assert.ok(errors.some((e) => e.includes(`.kind: must be one of ${ASSIGNMENT_KINDS.join(', ')}`)));
});

test('validateAssignment rejects a non-array touches', () => {
  const errors = validateAssignment(validAssignment({ touches: 'lib/a.mjs' }));
  assert.ok(errors.some((e) => e.includes('.touches:')));
});

test('validateAssignment rejects ownership missing a files array', () => {
  const errors = validateAssignment(validAssignment({ ownership: {} }));
  assert.ok(errors.some((e) => e.includes('.ownership.files:')));
});

test('validateWorkSpec accepts a well-formed spec', () => {
  assert.deepEqual(validateWorkSpec(validSpec()), []);
});

test('validateWorkSpec requires objective, desiredOutcome, dependencyRationale', () => {
  const errors = validateWorkSpec(validSpec({ objective: '', desiredOutcome: '', dependencyRationale: '' }));
  assert.ok(errors.includes('objective: required non-empty string'));
  assert.ok(errors.includes('desiredOutcome: required non-empty string'));
  assert.ok(errors.includes('dependencyRationale: required non-empty string'));
});

test('validateWorkSpec requires a non-empty decomposition', () => {
  const errors = validateWorkSpec(validSpec({ decomposition: [] }));
  assert.ok(errors.includes('decomposition: required non-empty array of Assignments'));
});

test('validateWorkSpec rejects duplicate assignment ids', () => {
  const errors = validateWorkSpec(validSpec({ decomposition: [validAssignment(), validAssignment()] }));
  assert.ok(errors.some((e) => e.includes('duplicate assignment id "a1"')));
});

test('validateWorkSpec rejects a dependsOn reference to an unknown assignment', () => {
  const errors = validateWorkSpec(validSpec({ decomposition: [validAssignment({ dependsOn: ['ghost'] })] }));
  assert.ok(errors.some((e) => e.includes('references unknown assignment id "ghost"')));
});

test('validateWorkSpec rejects a self-referential dependsOn', () => {
  const errors = validateWorkSpec(validSpec({ decomposition: [validAssignment({ dependsOn: ['a1'] })] }));
  assert.ok(errors.some((e) => e.includes('cannot depend on itself')));
});

test('createWorkSpec fills every documented field with a default', () => {
  const spec = createWorkSpec({ objective: 'x' });
  assert.equal(spec.objective, 'x');
  assert.equal(spec.state, 'draft');
  assert.deepEqual(spec.decomposition, []);
  assert.deepEqual(spec.ownership, { files: [], worktree: null });
  assert.equal(spec.graphValidation, null);
  assert.ok(spec.createdAt);
});

test('createWorkSpec preserves caller-supplied fields over defaults', () => {
  const spec = createWorkSpec({ objective: 'x', state: 'checked', decomposition: [validAssignment()] });
  assert.equal(spec.state, 'checked');
  assert.equal(spec.decomposition.length, 1);
});
