/**
 * tests/embed-approval-queue.test.mjs — ApprovalQueue unit tests.
 *
 * Covers basic queue operations, state transitions, expiry, and listing.
 * Extended broker-integration approval flow tests are in tests/mcp/approval-flow.test.mjs.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ApprovalQueue } from '../lib/embed/approval-queue.mjs';

describe('ApprovalQueue', () => {
  it('enqueues a tool call and returns a record with approvalId', () => {
    const q = new ApprovalQueue();
    const rec = q.enqueue({ tool: 'github.pr.merge', args: { number: 42 } });
    assert.ok(typeof rec.approvalId === 'string');
    assert.ok(rec.approvalId.startsWith('appr-'));
    assert.equal(rec.state, 'awaiting_approval');
    assert.equal(rec.toolCall.tool, 'github.pr.merge');
    assert.equal(rec.toolCall.args.number, 42);
  });

  it('deduplicates identical tool+args calls', () => {
    const q = new ApprovalQueue();
    const rec1 = q.enqueue({ tool: 'pr.merge', args: { id: 42 } });
    const rec2 = q.enqueue({ tool: 'pr.merge', args: { id: 42 } });
    assert.equal(rec1.approvalId, rec2.approvalId);
  });

  it('approve transitions state to approved', () => {
    const q = new ApprovalQueue();
    const rec = q.enqueue({ tool: 'test' });
    const approved = q.approve(rec.approvalId, { decidedBy: { userId: 'alice' } });
    assert.equal(approved.state, 'approved');
    assert.equal(approved.decidedBy.userId, 'alice');
    assert.ok(approved.decidedAt);
  });

  it('deny transitions state to denied', () => {
    const q = new ApprovalQueue();
    const rec = q.enqueue({ tool: 'test' });
    const denied = q.deny(rec.approvalId, { reason: 'not now' });
    assert.equal(denied.state, 'denied');
    assert.equal(denied.reason, 'not now');
  });

  it('throws when approving a non-pending item', () => {
    const q = new ApprovalQueue();
    const rec = q.enqueue({ tool: 'test' });
    q.approve(rec.approvalId);
    assert.throws(() => q.approve(rec.approvalId), /already/);
  });

  it('list filters by state', () => {
    const q = new ApprovalQueue();
    const r1 = q.enqueue({ tool: 'a' });
    const r2 = q.enqueue({ tool: 'b' });
    q.approve(r1.approvalId);
    const pending = q.list('awaiting_approval');
    const approved = q.list('approved');
    assert.equal(pending.length, 1);
    assert.equal(approved.length, 1);
    assert.equal(q.list().length, 2);
  });

  it('getById returns null for unknown id', () => {
    const q = new ApprovalQueue();
    assert.equal(q.getById('nonexistent'), null);
  });

  it('getPending returns only awaiting_approval records', () => {
    const q = new ApprovalQueue();
    q.enqueue({ tool: 'a' });
    q.enqueue({ tool: 'b' });
    assert.equal(q.getPending().length, 2);
  });

  it('expireStale expires items past their timeout', async () => {
    const q = new ApprovalQueue({ timeoutMs: 10 });
    q.enqueue({ tool: 'stale' });
    await new Promise((r) => setTimeout(r, 20));
    const expired = q.expireStale();
    assert.equal(expired.length, 1);
    assert.equal(expired[0].state, 'expired');
  });

  it('getByResumeToken finds record by resume token', () => {
    const q = new ApprovalQueue();
    const rec = q.enqueue({ tool: 'test' });
    const found = q.getByResumeToken(rec.resumeToken);
    assert.equal(found.approvalId, rec.approvalId);
  });
});
