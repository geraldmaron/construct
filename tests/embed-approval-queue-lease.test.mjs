/**
 * tests/embed-approval-queue-lease.test.mjs — durable execution lease
 * coverage for lib/embed/approval-queue.mjs (ADR-0089).
 *
 * Two ApprovalQueue instances pointed at the same persistPath stand in for
 * two OS processes racing acquireLease() on the same 'approved' record
 * (same convention as tests/embed-approval-queue-concurrency.test.mjs).
 * Covers: atomic lease acquisition, heartbeat liveness, expired-lease
 * safe-requeue (both the lazy acquireLease() path and the explicit
 * reclaimExpiredLeases() sweep), and release semantics on success/failure.
 */
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ApprovalQueue } from '../lib/embed/approval-queue.mjs';
import { rmTmpDir } from './helpers/cleanup.mjs';

const tmpDirs = [];
after(() => {
  for (const dir of tmpDirs) rmTmpDir(dir);
});

function freshPersistPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-approval-queue-lease-'));
  tmpDirs.push(dir);
  return path.join(dir, '.construct', 'approvals', 'queue.jsonl');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('ApprovalQueue — acquireLease atomicity', () => {
  it('only one of two racing acquireLease calls on the same approved record succeeds', () => {
    const persistPath = freshPersistPath();
    const q1 = new ApprovalQueue({ persistPath });
    const rec = q1.enqueue({ tool: 'jira.issue.transition', args: { id: 1 } });
    q1.approve(rec.approvalId);

    // q2 models a second process/worker that has not yet observed q1's
    // approve() when it starts racing for the lease.
    const q2 = new ApprovalQueue({ persistPath });

    const won = q1.acquireLease(rec.approvalId, { workerId: 'worker-1' });
    const lost = q2.acquireLease(rec.approvalId, { workerId: 'worker-2' });

    assert.ok(won, 'first acquirer must win the lease');
    assert.equal(won.state, 'executing');
    assert.equal(won.leaseWorkerId, 'worker-1');
    assert.equal(lost, null, 'second acquirer must not win a lease already held and live');

    const onDisk = q2.getById(rec.approvalId);
    assert.equal(onDisk.state, 'executing');
    assert.equal(onDisk.leaseWorkerId, 'worker-1');
  });

  it('acquireLease returns null for a record that was never approved', () => {
    const q = new ApprovalQueue();
    const rec = q.enqueue({ tool: 'test' });
    assert.equal(q.acquireLease(rec.approvalId, { workerId: 'w' }), null);
  });

  it('acquireLease throws for an unknown approvalId', () => {
    const q = new ApprovalQueue();
    assert.throws(() => q.acquireLease('nope'), /not found/);
  });
});

describe('ApprovalQueue — heartbeatLease liveness', () => {
  it('extends a live lease and keeps state executing', async () => {
    const q = new ApprovalQueue();
    const rec = q.enqueue({ tool: 'test' });
    q.approve(rec.approvalId);
    const leased = q.acquireLease(rec.approvalId, { leaseSeconds: 10, workerId: 'w1' });
    const firstExpiry = leased.leaseExpiresAt;

    await sleep(5);
    const beat = q.heartbeatLease(rec.approvalId, { leaseSeconds: 10, workerId: 'w1' });
    assert.ok(beat);
    assert.equal(beat.state, 'executing');
    assert.ok(new Date(beat.leaseExpiresAt).getTime() > new Date(firstExpiry).getTime(), 'heartbeat must push the expiry forward');
  });

  it('rejects a heartbeat from a worker that does not hold the lease', () => {
    const q = new ApprovalQueue();
    const rec = q.enqueue({ tool: 'test' });
    q.approve(rec.approvalId);
    q.acquireLease(rec.approvalId, { leaseSeconds: 10, workerId: 'w1' });
    assert.equal(q.heartbeatLease(rec.approvalId, { workerId: 'w2' }), null);
  });

  it('fails once the lease has genuinely expired', async () => {
    const q = new ApprovalQueue();
    const rec = q.enqueue({ tool: 'test' });
    q.approve(rec.approvalId);
    q.acquireLease(rec.approvalId, { leaseSeconds: 0.01, workerId: 'w1' });

    await sleep(30);
    const beat = q.heartbeatLease(rec.approvalId, { workerId: 'w1' });
    assert.equal(beat, null, 'heartbeat on an expired lease must fail closed, not silently renew it');
    assert.equal(q.getById(rec.approvalId).state, 'executing', 'expiry alone does not change state — only reclaim/reacquire does');
  });
});

describe('ApprovalQueue — expired-lease safe-requeue', () => {
  it('an expired executing lease is directly re-acquirable via acquireLease (not stuck, not silently terminal)', async () => {
    const q = new ApprovalQueue();
    const rec = q.enqueue({ tool: 'test' });
    q.approve(rec.approvalId);
    q.acquireLease(rec.approvalId, { leaseSeconds: 0.01, workerId: 'crashed-worker' });

    await sleep(30);
    const reacquired = q.acquireLease(rec.approvalId, { leaseSeconds: 10, workerId: 'recovering-worker' });
    assert.ok(reacquired, 'a crashed holder\'s expired lease must be reclaimable by a new acquirer');
    assert.equal(reacquired.state, 'executing');
    assert.equal(reacquired.leaseWorkerId, 'recovering-worker');
  });

  it('reclaimExpiredLeases sweeps expired executing records back to approved, never to a terminal state', async () => {
    const q = new ApprovalQueue();
    const rec = q.enqueue({ tool: 'test' });
    q.approve(rec.approvalId);
    q.acquireLease(rec.approvalId, { leaseSeconds: 0.01, workerId: 'crashed-worker' });

    await sleep(30);
    const reclaimed = q.reclaimExpiredLeases();
    assert.equal(reclaimed.length, 1);
    assert.equal(reclaimed[0].state, 'approved');
    assert.equal(reclaimed[0].leaseWorkerId, null);

    const onDisk = q.getById(rec.approvalId);
    assert.equal(onDisk.state, 'approved', 'reclaim must land on approved, not a terminal state like expired/executed');
  });

  it('reclaimExpiredLeases leaves live leases and non-executing records untouched', () => {
    const q = new ApprovalQueue();
    const live = q.enqueue({ tool: 'live' });
    q.approve(live.approvalId);
    q.acquireLease(live.approvalId, { leaseSeconds: 60, workerId: 'w' });

    const pending = q.enqueue({ tool: 'pending' });

    const reclaimed = q.reclaimExpiredLeases();
    assert.equal(reclaimed.length, 0);
    assert.equal(q.getById(live.approvalId).state, 'executing');
    assert.equal(q.getById(pending.approvalId).state, 'awaiting_approval');
  });
});

describe('ApprovalQueue — releaseLease outcomes', () => {
  it('a successful release transitions the record to the terminal executed state', () => {
    const q = new ApprovalQueue();
    const rec = q.enqueue({ tool: 'test' });
    q.approve(rec.approvalId);
    q.acquireLease(rec.approvalId, { workerId: 'w1' });

    const released = q.releaseLease(rec.approvalId, { workerId: 'w1', outcome: 'success' });
    assert.equal(released.state, 'executed');
    assert.ok(released.executedAt);
    assert.equal(released.leaseWorkerId, null);
    assert.equal(released.leaseExpiresAt, null);

    assert.equal(q.acquireLease(rec.approvalId, { workerId: 'w2' }), null, 'an executed record must never be re-acquired');
  });

  it('a failed release returns the record to approved so a later acquireLease can retry it', () => {
    const q = new ApprovalQueue();
    const rec = q.enqueue({ tool: 'test' });
    q.approve(rec.approvalId);
    q.acquireLease(rec.approvalId, { workerId: 'w1' });

    const released = q.releaseLease(rec.approvalId, { workerId: 'w1', outcome: 'failure', reason: 'network timeout' });
    assert.equal(released.state, 'approved');
    assert.equal(released.lastLeaseFailureReason, 'network timeout');
    assert.equal(released.leaseWorkerId, null);

    const retried = q.acquireLease(rec.approvalId, { workerId: 'w2' });
    assert.ok(retried, 'a failed release must leave the record re-acquirable');
    assert.equal(retried.leaseWorkerId, 'w2');
  });

  it('releaseLease throws when there is no active lease to release', () => {
    const q = new ApprovalQueue();
    const rec = q.enqueue({ tool: 'test' });
    q.approve(rec.approvalId);
    assert.throws(() => q.releaseLease(rec.approvalId, { workerId: 'w1' }), /no active lease/);
  });

  it('releaseLease throws when the caller does not hold the lease', () => {
    const q = new ApprovalQueue();
    const rec = q.enqueue({ tool: 'test' });
    q.approve(rec.approvalId);
    q.acquireLease(rec.approvalId, { workerId: 'w1' });
    assert.throws(() => q.releaseLease(rec.approvalId, { workerId: 'w2' }), /different worker/);
  });
});

describe('ApprovalQueue — lease extension does not disturb existing behavior', () => {
  it('enqueue/approve/deny/expireStale keep working exactly as before', async () => {
    const q = new ApprovalQueue({ timeoutMs: 10 });
    const a = q.enqueue({ tool: 'a' });
    const b = q.enqueue({ tool: 'b' });
    q.approve(a.approvalId);
    q.deny(b.approvalId, { reason: 'no' });
    assert.equal(q.getById(a.approvalId).state, 'approved');
    assert.equal(q.getById(b.approvalId).state, 'denied');

    const c = q.enqueue({ tool: 'c' });
    await sleep(20);
    const expired = q.expireStale();
    assert.equal(expired.length, 1);
    assert.equal(expired[0].approvalId, c.approvalId);
    assert.equal(expired[0].state, 'expired');
  });
});
