/**
 * tests/embed-approval-queue.test.mjs — ApprovalQueue unit tests.
 *
 * Covers basic queue operations, state transitions, expiry, and listing.
 * Extended broker-integration approval flow tests are in tests/mcp/approval-flow.test.mjs.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

  it('reloadFromDisk picks up a decision made by a separate instance at the same persistPath', (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'cx-approval-queue-reload-'));
    t.after(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });
    const persistPath = join(dir, 'queue.jsonl');
    const writer = new ApprovalQueue({ persistPath });
    const rec = writer.enqueue({ tool: 'jira.comment', args: { issueKey: 'X-1' } });

    const reader = new ApprovalQueue({ persistPath });
    assert.equal(reader.getById(rec.approvalId).state, 'awaiting_approval');

    writer.approve(rec.approvalId, { decidedBy: { userId: 'someone-else' } });

    // Readers reload per call (construct-4uxq0.9.9), so the sibling's
    // decision is visible immediately — no explicit reload required — and
    // an explicit reloadFromDisk() stays valid and idempotent on top.
    assert.equal(reader.getById(rec.approvalId).state, 'approved');

    reader.reloadFromDisk();
    const reloaded = reader.getById(rec.approvalId);
    assert.equal(reloaded.state, 'approved');
    assert.equal(reloaded.decidedBy.userId, 'someone-else');
  });

  it('reloadFromDisk is a no-op for an in-memory-only queue (no persistPath)', () => {
    const q = new ApprovalQueue();
    const rec = q.enqueue({ tool: 'test' });
    q.reloadFromDisk();
    assert.equal(q.getById(rec.approvalId).state, 'awaiting_approval', 'record survives — nothing was cleared');
  });

  it('reloadFromDisk on a path with nothing written yet leaves the queue empty', (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'cx-approval-queue-reload-empty-'));
    t.after(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });
    const persistPath = join(dir, 'queue.jsonl');
    const q = new ApprovalQueue({ persistPath });
    q.reloadFromDisk();
    assert.deepEqual(q.list(), []);
  });

  it('reloadFromDisk preserves the current in-memory state when the read fails, rather than clearing it', (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'cx-approval-queue-reload-fail-'));
    t.after(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });
    const persistPath = join(dir, 'queue.jsonl');
    const q = new ApprovalQueue({ persistPath });
    const rec = q.enqueue({ tool: 'jira.comment', args: { issueKey: 'X-1' } });

    // Force the next read to throw (EISDIR) rather than simulating a
    // malformed-but-readable file — a directory at the persist path is a
    // real, reproducible read failure, not a parse error the per-line
    // catch in #readItemsFromDisk already tolerates.

    rmSync(persistPath, { force: true });
    mkdirSync(persistPath, { recursive: true });

    q.reloadFromDisk();
    assert.equal(q.getById(rec.approvalId)?.state, 'awaiting_approval', 'a failed reload must not clear known-good in-memory state');
  });
});
