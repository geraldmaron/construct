/**
 * tests/workplace-loop/fingerprint.test.mjs — unit coverage for
 * lib/workplace-loop/fingerprint.mjs.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { fingerprintSignalInputs } from '../../lib/workplace-loop/fingerprint.mjs';

test('fingerprintSignalInputs is stable across record reordering', () => {
  const a = [{ id: 'GH-1', title: 'one' }, { id: 'GH-2', title: 'two' }];
  const b = [{ id: 'GH-2', title: 'two' }, { id: 'GH-1', title: 'one' }];
  assert.equal(fingerprintSignalInputs(a), fingerprintSignalInputs(b));
});

test('fingerprintSignalInputs is stable across key-order jitter within a record', () => {
  const a = [{ id: 'GH-1', title: 'one', state: 'open' }];
  const b = [{ state: 'open', id: 'GH-1', title: 'one' }];
  assert.equal(fingerprintSignalInputs(a), fingerprintSignalInputs(b));
});

test('fingerprintSignalInputs changes when a load-bearing field changes', () => {
  const before = fingerprintSignalInputs([{ id: 'GH-1', title: 'one', state: 'open' }]);
  const after = fingerprintSignalInputs([{ id: 'GH-1', title: 'one', state: 'closed' }]);
  assert.notEqual(before, after);
});

test('fingerprintSignalInputs changes when the record set changes size', () => {
  const before = fingerprintSignalInputs([{ id: 'GH-1' }]);
  const after = fingerprintSignalInputs([{ id: 'GH-1' }, { id: 'GH-2' }]);
  assert.notEqual(before, after);
});

test('fingerprintSignalInputs of an empty set is deterministic', () => {
  assert.equal(fingerprintSignalInputs([]), fingerprintSignalInputs([]));
});
