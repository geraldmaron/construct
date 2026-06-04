/**
 * tests/orchestration-events.test.mjs — run lifecycle event bus + cancel registry.
 *
 * Pins that a subscriber receives a run's events with runId + timestamp stamped,
 * that unsubscribe stops delivery, that one run's events never reach another
 * run's subscriber, and that the cooperative cancel registry sets/reads/clears.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { emitRunEvent, onRunEvent, requestCancel, isCancelRequested, clearCancel } from '../lib/orchestration/events.mjs';

test('subscriber receives events stamped with runId and timestamp', () => {
  const got = [];
  const off = onRunEvent('run-A', (e) => got.push(e));
  emitRunEvent('run-A', { type: 'running', status: 'running' });
  emitRunEvent('run-A', { type: 'completed', status: 'completed' });
  off();
  assert.equal(got.length, 2);
  assert.equal(got[0].type, 'running');
  assert.equal(got[0].runId, 'run-A');
  assert.match(got[0].at, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(got[1].status, 'completed');
});

test('unsubscribe stops delivery', () => {
  const got = [];
  const off = onRunEvent('run-B', (e) => got.push(e));
  emitRunEvent('run-B', { type: 'running' });
  off();
  emitRunEvent('run-B', { type: 'completed' });
  assert.equal(got.length, 1);
});

test('events for one run never reach another run’s subscriber', () => {
  const a = []; const b = [];
  const offA = onRunEvent('run-C', (e) => a.push(e));
  const offB = onRunEvent('run-D', (e) => b.push(e));
  emitRunEvent('run-C', { type: 'task', taskId: 't1' });
  offA(); offB();
  assert.equal(a.length, 1);
  assert.equal(b.length, 0);
});

test('emitRunEvent with no runId is a no-op', () => {
  assert.doesNotThrow(() => emitRunEvent(null, { type: 'x' }));
  assert.doesNotThrow(() => emitRunEvent(undefined, { type: 'x' }));
});

test('cancel registry sets, reads, and clears', () => {
  assert.equal(isCancelRequested('run-E'), false);
  requestCancel('run-E');
  assert.equal(isCancelRequested('run-E'), true);
  clearCancel('run-E');
  assert.equal(isCancelRequested('run-E'), false);
});
