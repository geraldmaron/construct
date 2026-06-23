/**
 * tests/evals-dataset.test.mjs — unit coverage for the provenance-backed eval
 * dataset (construct-6zga.1.6).
 *
 * Proves the dataset item validator preserves provenance, that split assignment is
 * deterministic and co-locates a source trace, that expiry is honored, and that
 * leakage exclusion strips a candidate's generating trace, near-duplicates, and the
 * same user correction from the evaluation set.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  validateDatasetItem, assignSplit, isExpired, nearDuplicateKey,
  excludeLeakage, selectEvalSet,
} from '../lib/evals/dataset.mjs';

function item(over = {}) {
  return {
    schemaVersion: 1,
    id: over.id || 'item-1',
    taskFamily: over.taskFamily || 'repo-summary',
    taskInput: over.taskInput || { prompt: 'summarize the repo', intent: 'investigation', risk: 'low' },
    capabilitySnapshot: over.capabilitySnapshot || { capabilityClass: 'hosted-direct', transport: 'direct', operatingProfileId: 'balanced' },
    allowedTools: over.allowedTools || ['read', 'search', 'construct'],
    expectedEvidenceBehavior: over.expectedEvidenceBehavior || { requirement: 'required', citationsRequired: true },
    expectedContractResult: over.expectedContractResult || { outcome: 'pass' },
    redaction: over.redaction || { state: 'raw', fields: [] },
    sourceTraceIds: over.sourceTraceIds || ['trace-100'],
    humanLabel: over.humanLabel || { provenance: 'human', labeledBy: 'gd', rubricVersion: 'r1', correctionId: null },
    split: over.split || 'test',
    expiry: 'expiry' in over ? over.expiry : null,
  };
}

test('a complete item validates and preserves provenance', () => {
  assert.ok(validateDatasetItem(item()).valid);
});

test('the validator rejects an invalid capability class and an empty source trace', () => {
  const badClass = validateDatasetItem(item({ capabilitySnapshot: { capabilityClass: 'wishful' } }));
  assert.equal(badClass.valid, false);
  assert.ok(badClass.errors.some((e) => e.includes('capabilityClass')));
  const noTrace = validateDatasetItem(item({ sourceTraceIds: [] }));
  assert.equal(noTrace.valid, false);
  assert.ok(noTrace.errors.some((e) => e.includes('sourceTraceIds')));
});

test('split assignment is deterministic and co-locates a source trace', () => {
  const a = item({ id: 'a', sourceTraceIds: ['trace-shared'] });
  const b = item({ id: 'b', sourceTraceIds: ['trace-shared'] });
  assert.equal(assignSplit(a), assignSplit(a), 'same item must hash to the same split');
  assert.equal(assignSplit(a), assignSplit(b), 'a shared source trace must land in one split');
});

test('expiry is honored against an injected clock', () => {
  assert.equal(isExpired(item({ expiry: '2020-01-01' }), '2026-06-21'), true);
  assert.equal(isExpired(item({ expiry: '2030-01-01' }), '2026-06-21'), false);
  assert.equal(isExpired(item({ expiry: null }), '2026-06-21'), false);
});

test('leakage exclusion strips the generating trace, near-duplicates, and the same correction', () => {
  const pool = [
    item({ id: 'gen', sourceTraceIds: ['trace-gen'] }),
    item({ id: 'dup', sourceTraceIds: ['trace-x'], taskInput: { prompt: 'Summarize   the REPO' } }),
    item({ id: 'corr', sourceTraceIds: ['trace-y'], humanLabel: { provenance: 'human', correctionId: 'c-42' } }),
    item({ id: 'safe', sourceTraceIds: ['trace-z'], taskInput: { prompt: 'unrelated task' } }),
  ];
  const candidate = {
    generatingTraceIds: ['trace-gen'],
    taskInput: { prompt: 'summarize the repo' },
    correctionId: 'c-42',
  };
  const kept = excludeLeakage(pool, candidate).map((i) => i.id);
  assert.deepEqual(kept, ['safe']);
});

test('nearDuplicateKey normalizes whitespace and case', () => {
  assert.equal(
    nearDuplicateKey({ taskInput: { prompt: 'Hello   World' } }),
    nearDuplicateKey({ taskInput: { prompt: 'hello world' } }),
  );
});

test('selectEvalSet returns held-out, unexpired, leak-free items', () => {
  const pool = [
    item({ id: 'train-1', split: 'train' }),
    item({ id: 'test-expired', split: 'test', sourceTraceIds: ['t-exp'], expiry: '2020-01-01' }),
    item({ id: 'test-gen', split: 'test', sourceTraceIds: ['trace-gen'] }),
    item({ id: 'test-safe', split: 'test', sourceTraceIds: ['t-safe'], taskInput: { prompt: 'distinct held-out task' } }),
  ];
  const candidate = { generatingTraceIds: ['trace-gen'], taskInput: { prompt: 'something else entirely' } };
  const kept = selectEvalSet(pool, candidate, { split: 'test', nowIso: '2026-06-21' }).map((i) => i.id);
  assert.deepEqual(kept, ['test-safe']);
});
