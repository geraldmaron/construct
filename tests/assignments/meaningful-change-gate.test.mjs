/**
 * tests/assignments/meaningful-change-gate.test.mjs
 *
 * Hermetic unit tests for lib/assignments/meaningful-change-gate.mjs.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildCapabilityTickGateInput,
  evaluateMeaningfulChangeGate,
  GATE_STAGE_ORDER,
  MEANINGFUL_CHANGE_SKIP_PREFIX,
} from '../../lib/assignments/meaningful-change-gate.mjs';

test('GATE_STAGE_ORDER lists six deterministic stages', () => {
  assert.deepEqual(GATE_STAGE_ORDER, [
    'cursor',
    'dedup',
    'filter',
    'content-hash',
    'relevance',
    'prior-run',
  ]);
});

test('evaluateMeaningfulChangeGate proceeds on first run with records', () => {
  const result = evaluateMeaningfulChangeGate({
    records: [
      { id: 'GH-1', state: 'open', title: 'Real blocker', labels: ['blocker'], assignee: 'alice', body: 'x'.repeat(50) },
    ],
    filters: { applyNoiseFilter: true },
  });
  assert.equal(result.proceed, true);
  assert.equal(result.skippedAtStage, null);
  assert.match(result.contentHash ?? '', /^[a-f0-9]{64}$/);
  assert.equal(result.stages.length, 6);
});

test('evaluateMeaningfulChangeGate blocks unchanged cursor', () => {
  const result = evaluateMeaningfulChangeGate({
    cursor: { current: 'abc123', consumed: 'abc123' },
    records: [{ id: '1', state: 'open', title: 't', body: 'substantive body long enough' }],
  });
  assert.equal(result.proceed, false);
  assert.equal(result.skippedAtStage, 'cursor');
  assert.equal(result.reason, 'cursor-unchanged');
});

test('evaluateMeaningfulChangeGate blocks duplicate delivery', () => {
  const result = evaluateMeaningfulChangeGate({
    dedupKey: 'tick-1',
    recentDedupKeys: ['tick-1'],
    payload: { foo: 'bar' },
  });
  assert.equal(result.proceed, false);
  assert.equal(result.skippedAtStage, 'dedup');
  assert.equal(result.reason, 'duplicate-delivery');
});

test('evaluateMeaningfulChangeGate filters noise records', () => {
  const result = evaluateMeaningfulChangeGate({
    records: [
      { id: 'N-1', state: 'open', title: 'short', labels: [], assignee: null, body: 'hi' },
    ],
    filters: { applyNoiseFilter: true },
  });
  assert.equal(result.proceed, false);
  assert.equal(result.skippedAtStage, 'filter');
  assert.equal(result.reason, 'all-records-filtered-as-noise');
});

test('evaluateMeaningfulChangeGate blocks when content hash matches prior run', () => {
  const first = evaluateMeaningfulChangeGate({
    records: [
      { id: 'GH-2', state: 'open', title: 'Issue', labels: ['bug'], assignee: 'bob', body: 'substantive enough body here' },
    ],
  });
  assert.equal(first.proceed, true);
  const second = evaluateMeaningfulChangeGate({
    records: [
      { id: 'GH-2', state: 'open', title: 'Issue', labels: ['bug'], assignee: 'bob', body: 'substantive enough body here' },
    ],
    priorRun: { contentHash: first.contentHash },
  });
  assert.equal(second.proceed, false);
  assert.equal(second.skippedAtStage, 'prior-run');
  assert.equal(second.reason, 'no-change-since-last-run');
});

test('buildCapabilityTickGateInput maps sections and prior state', () => {
  const input = buildCapabilityTickGateInput({
    sections: [{ provider: 'github', items: [{ id: 'GH-3', title: 't', body: 'body' }] }],
    assignmentState: { lastContentHash: 'deadbeef'.repeat(8) },
    dedupKey: 'cap:ops:2026',
  });
  assert.equal(input.dedupKey, 'cap:ops:2026');
  assert.equal(input.priorRun.contentHash, 'deadbeef'.repeat(8));
  assert.equal(input.records?.length, 1);
});

test('MEANINGFUL_CHANGE_SKIP_PREFIX is stable for tick recording', () => {
  assert.equal(MEANINGFUL_CHANGE_SKIP_PREFIX, 'meaningful-change-gate');
});
