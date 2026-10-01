import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { freshStore } from '../state/support.ts';
import { claimWork, createWork, getWork } from '../../../src/kernel/work/service.ts';
import { registerSession } from '../../../src/kernel/state/sessions.ts';
import { createDelegationService, executions, normalizeAssignment } from '../../../src/kernel/delegation/service.ts';
import type { Assignment, DelegationDriver, DelegationService, WorkerResult } from '../../../src/kernel/delegation/types.ts';

const NOW = '2026-09-27T12:00:00.000Z';
const UNTIL = '2026-09-27T14:00:00.000Z';
const SUCCESS: WorkerResult = { state: 'succeeded', summary: 'bounded work finished', findings: [], usage: null };
const assignment = (patch: Partial<Assignment> = {}): Assignment => ({ workId: 'parent', requestKey: 'first', executor: 'codex', role: 'implement', instructions: 'Change the bounded file', acceptance: ['The fixture gate passes'], paths: ['src/'], couplingKeys: [], timeoutMs: 10_000, ...patch });

function fixture(overrides: Partial<DelegationDriver> = {}) {
  const state = freshStore();
  registerSession(state.store, { id: 'lead', host: 'codex', surface: 'interactive', machine: 'test', at: NOW });
  createWork(state.store, { id: 'parent', kind: 'task', title: 'Bounded work', description: 'Implement', at: NOW });
  claimWork(state.store, { id: 'parent', owner: 'lead-owner', session: 'lead', now: NOW, until: UNTIL });
  const driver: DelegationDriver = {
    machine: 'test', maxWorkers: 2, maxRepairCycles: 2, maxTimeoutMs: 20_000,
    async status(executor) { return { executor, installed: true, authenticated: 'subscription', configured: true, liveVerified: true, model: 'fixture-model', reason: 'fixture boundary' }; },
    async prepare(execution) { return { directory: execution.id, baseRevision: 'base', baselineTree: 'tree', targetFingerprint: 'target' }; },
    async launch() { return SUCCESS; }, async cancel() {},
    async collect() { return { tree: 'tree', patch: 'patch', digest: 'digest', paths: ['src/file'] }; },
    async integrate() {}, async validate() { return [{ command: ['fixture-gate'], passed: true }]; }, alive() { return false; }, ...overrides,
  };
  const service = createDelegationService({ store: state.store, sessionId: 'lead', target: state.root, now: () => NOW, driver });
  return { ...state, service, driver, async cleanup() { await service.close(); state.cleanup(); } };
}

async function settled(service: DelegationService, id: string) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const current = service.result(id);
    if (!['queued', 'running'].includes(current.state)) return current;
    await setImmediate();
  }
  throw new Error('fixture did not settle');
}

test('dispatch is idempotent, creates distinct native identity, and never completes parent or child', async () => {
  let launches = 0;
  const fixtureState = fixture({ async launch() { launches += 1; return SUCCESS; } });
  try {
    const [first, retry] = await Promise.all([fixtureState.service.start(assignment()), fixtureState.service.start(assignment())]);
    assert.equal(first.id, retry.id);
    const done = await settled(fixtureState.service, first.id);
    assert.equal(done.state, 'succeeded');
    assert.equal(launches, 1);
    assert.notEqual(first.workerSession, first.leadSession);
    assert.equal(getWork(fixtureState.store, first.childWorkId)?.parentId, 'parent');
    assert.equal(getWork(fixtureState.store, first.childWorkId)?.status, 'open');
    assert.equal(getWork(fixtureState.store, 'parent')?.status, 'claimed');
    assert.equal(JSON.stringify(done).includes('claimToken'), false);
    await assert.rejects(fixtureState.service.start(assignment({ instructions: 'Different assignment' })), /requestKey/);
  } finally { await fixtureState.cleanup(); }
});

test('missing authorization and expired parent claims refuse before creating children', async () => {
  const fixtureState = fixture({ async status(executor) { return { executor, installed: true, configured: false, authenticated: 'unknown', liveVerified: false, model: null, reason: 'not authorized' }; } });
  try {
    await assert.rejects(fixtureState.service.start(assignment()), /executor disabled/);
    assert.equal(executions(fixtureState.store).length, 0);
    const service = createDelegationService({ store: fixtureState.store, sessionId: 'lead', target: fixtureState.root, now: () => UNTIL, driver: { ...fixtureState.driver, async status(executor) { return { executor, installed: true, configured: true, authenticated: 'subscription', liveVerified: true, model: 'fixture', reason: 'fixture' }; } } });
    await assert.rejects(service.start(assignment()), /unexpired claim/);
  } finally { await fixtureState.cleanup(); }
});

test('path reservations, semantic coupling and concurrency are checked transactionally', async () => {
  const completions = new Map<string, (value: WorkerResult) => void>();
  const fixtureState = fixture({ launch(execution) { return new Promise(resolve => completions.set(execution.id, resolve)); }, async cancel(id) { completions.get(id)?.({ ...SUCCESS, state: 'cancelled' }); } });
  try {
    const first = await fixtureState.service.start(assignment({ couplingKeys: ['schema'] }));
    await assert.rejects(fixtureState.service.start(assignment({ requestKey: 'coupled', paths: ['other/'], couplingKeys: ['schema'] })), /coupled/);
    await assert.rejects(fixtureState.service.start(assignment({ requestKey: 'overlap' })), /reserved/);
    const second = await fixtureState.service.start(assignment({ requestKey: 'second', paths: ['other/'] }));
    await assert.rejects(fixtureState.service.start(assignment({ requestKey: 'third', paths: ['third/'] })), /concurrency/);
    await setImmediate();
    assert.equal((await fixtureState.service.cancel(first.id)).state, 'cancelled');
    assert.equal((await fixtureState.service.cancel(second.id)).state, 'cancelled');
  } finally { await fixtureState.cleanup(); }
});

test('review findings require evidence, explicit dispositions, and block integration until resolved', async () => {
  const fixtureState = fixture({ async launch(execution) {
    return execution.assignment.role === 'review' ? { ...SUCCESS, findings: [{ id: 'finding', path: 'src/file', requirement: 'Preserve invariant', evidence: 'Fixture violates invariant', blocking: true }] } : SUCCESS;
  } });
  try {
    const implementation = await fixtureState.service.start(assignment());
    await settled(fixtureState.service, implementation.id);
    await assert.rejects(fixtureState.service.integrate(implementation.id), /independent review/);
    const review = await fixtureState.service.start(assignment({ requestKey: 'review', executor: 'claude', role: 'review', subject: implementation.id }));
    const reviewed = await settled(fixtureState.service, review.id);
    assert.match(reviewed.reason!, /independence is limited/);
    await assert.rejects(fixtureState.service.integrate(implementation.id), /unresolved findings/);
    fixtureState.service.triage(review.id, [{ findingId: 'finding', decision: 'deferred', rationale: 'Needs investigation' }]);
    await assert.rejects(fixtureState.service.integrate(implementation.id), /unresolved findings/);
    fixtureState.service.triage(review.id, [{ findingId: 'finding', decision: 'rejected', rationale: 'The measured fixture invariant already holds' }]);
    assert.equal((await fixtureState.service.integrate(implementation.id)).state, 'integrated');
    assert.equal((fixtureState.store.db.prepare('SELECT status FROM reviews WHERE id = ?').get(review.id) as { status: string }).status, 'resolved');
  } finally { await fixtureState.cleanup(); }
});

test('clean integration with failed combined validation is never accepted', async () => {
  const fixtureState = fixture({ async validate(_execution, stage) { return [{ command: ['real-gate'], passed: stage === 'worker' }]; } });
  try {
    const implementation = await fixtureState.service.start(assignment());
    await settled(fixtureState.service, implementation.id);
    const review = await fixtureState.service.start(assignment({ requestKey: 'review', role: 'review', subject: implementation.id }));
    await settled(fixtureState.service, review.id);
    assert.equal((await fixtureState.service.integrate(implementation.id)).state, 'integration_failed');
    assert.equal(getWork(fixtureState.store, 'parent')?.status, 'claimed');
  } finally { await fixtureState.cleanup(); }
});

test('worker validation failure blocks review and repair cycles cannot exceed the configured bound', async () => {
  const fixtureState = fixture();
  try {
    let last = await fixtureState.service.start(assignment());
    const original = last;
    await settled(fixtureState.service, last.id);
    for (const cycle of [1, 2]) {
      last = await fixtureState.service.start(assignment({ requestKey: `repair-${cycle}`, repairOf: last.id }));
      await settled(fixtureState.service, last.id);
      assert.equal(last.repairCycle, cycle);
    }
    await assert.rejects(fixtureState.service.start(assignment({ requestKey: 'repair-3', repairOf: last.id })), /repair limit/);
    await assert.rejects(fixtureState.service.start(assignment({ requestKey: 'branched-repair', repairOf: original.id })), /repair limit/);
  } finally { await fixtureState.cleanup(); }
  const failing = fixture({ async validate() { return []; } });
  try {
    const last = await failing.service.start(assignment());
    assert.equal((await settled(failing.service, last.id)).state, 'blocked');
    await assert.rejects(failing.service.start(assignment({ requestKey: 'review', role: 'review', subject: last.id })), /successful implementation/);
  } finally { await failing.cleanup(); }
});

test('claim loss during execution quarantines output', async () => {
  let finish!: (value: WorkerResult) => void;
  const fixtureState = fixture({ launch() { return new Promise(resolve => { finish = resolve; }); } });
  try {
    const started = await fixtureState.service.start(assignment());
    await setImmediate();
    fixtureState.store.db.prepare('UPDATE work_items SET claim_until = ? WHERE id = ?').run(NOW, started.childWorkId);
    finish(SUCCESS);
    assert.match((await settled(fixtureState.service, started.id)).reason!, /claim expired/);
  } finally { await fixtureState.cleanup(); }
});

test('restart does not mistake a lease or unknown process identity for a dead worker', async () => {
  const fixtureState = fixture();
  try {
    const first = await fixtureState.service.start(assignment());
    await settled(fixtureState.service, first.id);
    const record = { ...fixtureState.service.result(first.id), state: 'running', supervisorPid: 12345, groupPid: 12346 };
    fixtureState.store.db.prepare('INSERT INTO work_events (work_id, at, kind, actor, payload_json) VALUES (?, ?, ?, ?, ?)').run(first.childWorkId, NOW, 'delegation.state.v1', 'lead', JSON.stringify(record));
    const restarted = createDelegationService({ store: fixtureState.store, sessionId: 'lead', target: fixtureState.root, now: () => NOW, driver: { ...fixtureState.driver, alive() { return null; } } });
    await restarted.status(first.id);
    assert.equal(restarted.result(first.id).state, 'orphaned');
    await assert.rejects(restarted.start(assignment({ requestKey: 'retry' })), /orphaned/);
  } finally { await fixtureState.cleanup(); }
});

test('assignment rejects broad scope, malformed bounds, secrets, and unmatched review subjects', () => {
  assert.throws(() => normalizeAssignment(assignment({ paths: ['/'] })), /relative|bounded paths/);
  assert.throws(() => normalizeAssignment(assignment({ paths: ['../escape'] })), /inside/);
  assert.throws(() => normalizeAssignment(assignment({ timeoutMs: Infinity })), /timeoutMs/);
  assert.throws(() => normalizeAssignment(assignment({ role: 'review' })), /fixed subject/);
  assert.throws(() => normalizeAssignment(assignment({ instructions: `sk-ant-${'a1'.repeat(30)}` })), /credential/);
});
