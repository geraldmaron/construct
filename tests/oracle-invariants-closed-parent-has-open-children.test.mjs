/**
 * tests/oracle-invariants-closed-parent-has-open-children.test.mjs — closed-parent-has-open-children invariant.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  id,
  layer,
  hasClarificationAnnotation,
  OPEN_CHILDREN_ANNOTATION_PREFIX,
  check,
} from '../lib/oracle/invariants/closed-parent-has-open-children.mjs';

test('invariant module exports id/layer per the registry contract', () => {
  assert.equal(id, 'closed-parent-has-open-children');
  assert.equal(layer, 1);
});

test('hasClarificationAnnotation detects the documented prefix', () => {
  assert.equal(hasClarificationAnnotation(`${OPEN_CHILDREN_ANNOTATION_PREFIX}2026-07-17)`), true);
  assert.equal(hasClarificationAnnotation('ordinary notes'), false);
});

test('check flags closed parent with open child', async () => {
  const result = await check({
    listClosedBeads: async () => [{ id: 'parent-1', notes: '' }],
    listOpenBeads: async () => [{ id: 'child-1', status: 'open', parent: 'parent-1' }],
  });
  assert.equal(result.status, 'failed');
  assert.equal(result.violations.length, 1);
  assert.equal(result.violations[0].beadId, 'parent-1');
});

test('check passes when clarification annotation is present', async () => {
  const result = await check({
    listClosedBeads: async () => [{
      id: 'parent-2',
      notes: `${OPEN_CHILDREN_ANNOTATION_PREFIX}follow-on epics remain open by design)`,
    }],
    listOpenBeads: async () => [{ id: 'child-2', status: 'open', parent: 'parent-2' }],
  });
  assert.equal(result.status, 'passed');
  assert.equal(result.violations.length, 0);
});
