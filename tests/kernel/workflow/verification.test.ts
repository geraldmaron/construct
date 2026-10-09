import { brokerFixture } from '../broker/support.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requestedFileProblems, persistedRecordProblems, artifactRefs, verificationReceipt, staleReceiptSubjects } from '../../../src/kernel/workflow/verification.ts';
import type { RefResolver } from '../../../src/kernel/project/evidence.ts';

const resolve = (text: string): RefResolver => (ref) => ref === 'report.md' ? { ref, kind: 'file', provenance: 'witnessed', text } : null;
test('structural receipts bind observed content and never upgrade a host execution claim', () => {
  const receipt = verificationReceipt({ runId: 'run-a', stepRunId: 'step-a', actor: 'session-a', observedAt: '2026-10-09T00:00:00Z', subjects: ['report.md'], evidence: [{ ref: 'unrecorded' }], checks: [{ validator: 'artifacts_exist', ok: true }], resolve: resolve('one') });
  assert.equal(receipt.assurance, 'structural');
  assert.equal(receipt.executionVerified, false);
  assert.equal(receipt.semanticSupportVerified, false);
  assert.match(receipt.subjects[0]?.digest ?? '', /^[a-f0-9]{64}$/);
  assert.equal(receipt.evidence[0]?.provenance, 'unresolved');
  assert.deepEqual(staleReceiptSubjects(receipt, resolve('one')), []);
  assert.deepEqual(staleReceiptSubjects(receipt, resolve('two')), ['report.md']);
  assert.deepEqual(staleReceiptSubjects(receipt, () => null), ['report.md']);
});
test('unknown artifact bytes remain unverified and cannot pass later identity checks', () => {
  const receipt = verificationReceipt({ runId: 'r', stepRunId: 's', actor: 'a', observedAt: '2026-10-09T00:00:00Z', subjects: ['binary'], evidence: [], checks: [], resolve: (ref) => ({ ref, kind: 'file', provenance: 'witnessed', size: 999999999 }) });
  assert.equal(receipt.subjects[0]?.digest, null);
  assert.deepEqual(staleReceiptSubjects(receipt, () => null), ['binary']);
  assert.deepEqual(artifactRefs({ artifact: 'a', changes: ['a', 'b'], executionVerified: true }), ['a', 'b']);
});


test('structured artifact paths and changed evidence cannot escape byte identity checks', () => {
  assert.deepEqual(artifactRefs({ artifact: { path: 'report.md' }, changes: [{ path: 'a.md' }, { path: 'removed.md', removed: true }, 'a.md'] }), ['report.md', 'a.md']);
  let evidence = 'Original constraint';
  const resolve: RefResolver = (ref) => ({ ref, kind: 'file', provenance: 'witnessed', text: ref === 'report.md' ? 'Same report' : evidence });
  const receipt = verificationReceipt({ runId: 'r', stepRunId: 's', actor: 'a', observedAt: '2026-10-09T00:00:00Z', subjects: ['report.md'], evidence: [{ ref: 'policy.md' }], checks: [], resolve });
  evidence = 'Corrected constraint';
  assert.deepEqual(staleReceiptSubjects(receipt, resolve), ['policy.md']);
});


test('persistence claims cannot invent finding or lesson IDs', () => {
  const fx = brokerFixture();
  try {
    assert.deepEqual(persistedRecordProblems(fx.broker.store, { recordedIds: [], lessonIds: [] }), []);
    assert.equal(persistedRecordProblems(fx.broker.store, { recordedIds: ['pretend-finding'], lessonIds: ['pretend-lesson'] }).length, 2);
    assert.equal(persistedRecordProblems(fx.broker.store, { recordedFindingIds: 'invented' }).length, 1);
  } finally { fx.cleanup(); }
});


test('a requested file requires a real artifact, not only a successful database result', () => {
  const destination = { kind: 'project_file', ref: 'report.md' };
  assert.equal(requestedFileProblems(destination, [], resolve('report')).length, 1);
  assert.equal(requestedFileProblems(destination, ['report.md'], () => null).length, 1);
  assert.equal(requestedFileProblems(destination, ['report.md'], resolve('')).length, 1);
  assert.deepEqual(requestedFileProblems(destination, ['./report.md'], resolve('report')), []);
  assert.deepEqual(requestedFileProblems({ kind: 'chat', ref: null }, [], () => null), []);
});
