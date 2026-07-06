/**
 * tests/flows-state.test.mjs — typed state transitions.
 *
 * Pins that a valid delta merges into a new state object without mutating the
 * caller's original state, and that an invalid transition returns a
 * structured rejection (never a thrown exception, never a silently applied
 * partial update) carrying the schema violations.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createInitialState, transition } from '../lib/flows/state.mjs';

const schema = {
  type: 'object',
  required: ['stage'],
  properties: {
    stage: { type: 'string' },
    count: { type: 'integer' },
  },
};

test('createInitialState accepts a seed matching the schema', () => {
  const result = createInitialState(schema, { stage: 'start' });
  assert.equal(result.ok, true);
  assert.deepEqual(result.state, { stage: 'start' });
});

test('createInitialState rejects a seed missing a required field', () => {
  const result = createInitialState(schema, { count: 1 });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'INVALID_INITIAL_STATE');
});

test('transition merges a valid delta into a new state object', () => {
  const before = { stage: 'start', count: 0 };
  const result = transition(schema, before, { count: 1 });
  assert.equal(result.ok, true);
  assert.deepEqual(result.state, { stage: 'start', count: 1 });
  assert.deepEqual(before, { stage: 'start', count: 0 }, 'original state is untouched');
});

test('transition rejects a delta that produces invalid state', () => {
  const before = { stage: 'start', count: 0 };
  const result = transition(schema, before, { count: 'oops' });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'INVALID_STATE_TRANSITION');
  assert.ok(result.error.errors.length > 0);
});
