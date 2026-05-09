/**
 * tests/embed-approval-queue.test.mjs — approval queue tests.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ApprovalQueue } from '../lib/embed/approval-queue.mjs';

describe('ApprovalQueue', () => {
  it('enqueues an action and returns an id', () => {
    const q = new ApprovalQueue({ require: ['pr.merge'] });
    const id = q.enqueue({ type: 'pr.merge', provider: 'github', payload: { number: 42 } });
    assert.ok(typeof id === 'string');
    assert.equal(q.get(id).status, 'pending');
  });

  it('requiresApproval matches exact patterns', () => {
    const q = new ApprovalQueue({ require: ['pr.merge', 'issue.create'] });
    assert.ok(q.requiresApproval('pr.merge'));
    assert.ok(!q.requiresApproval('pr.view'));
  });

  it('requiresApproval supports wildcard suffix', () => {
    const q = new ApprovalQueue({ require: ['pr.*'] });
    assert.ok(q.requiresApproval('pr.merge'));
    assert.ok(q.requiresApproval('pr.create'));
    assert.ok(!q.requiresApproval('issue.create'));
  });

  it('approve transitions status to approved', () => {
    const q = new ApprovalQueue({ require: [] });
    const id = q.enqueue({ type: 'test' });
    q.approve(id, { approvedBy: 'alice' });
    const item = q.get(id);
    assert.equal(item.status, 'approved');
    assert.equal(item.approvedBy, 'alice');
  });

  it('reject transitions status to rejected', () => {
    const q = new ApprovalQueue({ require: [] });
    const id = q.enqueue({ type: 'test' });
    q.reject(id, { reason: 'not now' });
    assert.equal(q.get(id).status, 'rejected');
  });

  it('throws when approving a non-pending item', () => {
    const q = new ApprovalQueue({ require: [] });
    const id = q.enqueue({ type: 'test' });
    q.approve(id);
    assert.throws(() => q.approve(id), /already/);
  });

  it('list filters by status', () => {
    const q = new ApprovalQueue({ require: [] });
    const id1 = q.enqueue({ type: 'a' });
    const id2 = q.enqueue({ type: 'b' });
    q.approve(id1);
    assert.equal(q.list('pending').length, 1);
    assert.equal(q.list('approved').length, 1);
    assert.equal(q.list().length, 2);
  });

  it('expireStale expires items past their timeout', async () => {
    const q = new ApprovalQueue({ require: [], timeoutMs: 10, fallback: 'reject' });
    q.enqueue({ type: 'stale' });
    await new Promise((r) => setTimeout(r, 20));
    const expired = q.expireStale();
    assert.equal(expired.length, 1);
    assert.equal(expired[0].status, 'expired');
  });

  it('expireStale with fallback:proceed approves expired items', async () => {
    const q = new ApprovalQueue({ require: [], timeoutMs: 10, fallback: 'proceed' });
    q.enqueue({ type: 'auto' });
    await new Promise((r) => setTimeout(r, 20));
    q.expireStale();
    const items = q.list('approved');
    assert.equal(items.length, 1);
  });
});
