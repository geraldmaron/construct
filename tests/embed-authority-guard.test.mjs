/**
 * tests/embed-authority-guard.test.mjs — AuthorityGuard unit tests.
 *
 * Uses the real ApprovalQueue (in-memory, no persistPath) rather than a
 * hand-rolled mock — a mock that mirrors AuthorityGuard's own assumptions
 * about the queue's shape can't catch a mismatch between the two.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AuthorityGuard } from '../lib/embed/authority-guard.mjs';
import { ApprovalQueue } from '../lib/embed/approval-queue.mjs';
import { DEFAULT_OPERATING_PROFILE } from '../lib/embed/config.mjs';

function makeQueue() {
  return new ApprovalQueue();
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('AuthorityGuard', () => {
  describe('autonomous actions', () => {
    it('allows read without queuing', async () => {
      const queue = makeQueue();
      const guard = new AuthorityGuard(DEFAULT_OPERATING_PROFILE, queue);
      const result = await guard.check('read');
      assert.equal(result.allowed, true);
      assert.equal(result.mode, 'autonomous');
      assert.equal(queue.getPending().length, 0);
    });

    it('allows summarize without queuing', async () => {
      const guard = new AuthorityGuard(DEFAULT_OPERATING_PROFILE, makeQueue());
      const result = await guard.check('summarize');
      assert.equal(result.allowed, true);
    });

    it('allows draftArtifacts without queuing', async () => {
      const guard = new AuthorityGuard(DEFAULT_OPERATING_PROFILE, makeQueue());
      const result = await guard.check('draftArtifacts');
      assert.equal(result.allowed, true);
    });

    it('allows artifact:prd (maps to draftArtifacts)', async () => {
      const guard = new AuthorityGuard(DEFAULT_OPERATING_PROFILE, makeQueue());
      const result = await guard.check('artifact:prd');
      assert.equal(result.allowed, true);
    });

    it('allows artifact:adr', async () => {
      const guard = new AuthorityGuard(DEFAULT_OPERATING_PROFILE, makeQueue());
      const result = await guard.check('artifact:adr');
      assert.equal(result.allowed, true);
    });
  });

  describe('approval-queued actions', () => {
    it('queues externalPost and returns queueId', async () => {
      const queue = makeQueue();
      const guard = new AuthorityGuard(DEFAULT_OPERATING_PROFILE, queue);
      const result = await guard.check('externalPost', { payload: { channel: '#general' } });
      assert.equal(result.allowed, false);
      assert.equal(result.mode, 'queued');
      assert.ok(result.queueId, 'should have a queueId');
      const pending = queue.getPending();
      assert.equal(pending.length, 1);
      assert.equal(pending[0].toolCall.tool, 'externalPost');
      assert.deepEqual(pending[0].toolCall.args, { channel: '#general' });
    });

    it('queues slack:post (maps to externalPost)', async () => {
      const queue = makeQueue();
      const guard = new AuthorityGuard(DEFAULT_OPERATING_PROFILE, queue);
      const result = await guard.check('slack:post');
      assert.equal(result.allowed, false);
      assert.equal(result.mode, 'queued');
      assert.equal(queue.getPending()[0].toolCall.tool, 'externalPost');
    });

    it('queues createIssues', async () => {
      const guard = new AuthorityGuard(DEFAULT_OPERATING_PROFILE, makeQueue());
      const result = await guard.check('createIssues');
      assert.equal(result.allowed, false);
      assert.equal(result.mode, 'queued');
    });

    it('queues issue:create (maps to createIssues)', async () => {
      const queue = makeQueue();
      const guard = new AuthorityGuard(DEFAULT_OPERATING_PROFILE, queue);
      const result = await guard.check('issue:create');
      assert.equal(result.allowed, false);
      assert.equal(queue.getPending()[0].toolCall.tool, 'createIssues');
    });

    it('queues updateIssues', async () => {
      const guard = new AuthorityGuard(DEFAULT_OPERATING_PROFILE, makeQueue());
      const result = await guard.check('updateIssues');
      assert.equal(result.allowed, false);
    });

    it('queues publishDocs', async () => {
      const guard = new AuthorityGuard(DEFAULT_OPERATING_PROFILE, makeQueue());
      const result = await guard.check('publishDocs');
      assert.equal(result.allowed, false);
    });

    it('queues repoWrites', async () => {
      const guard = new AuthorityGuard(DEFAULT_OPERATING_PROFILE, makeQueue());
      const result = await guard.check('repoWrites');
      assert.equal(result.allowed, false);
    });

    it('queues git:commit (maps to repoWrites)', async () => {
      const queue = makeQueue();
      const guard = new AuthorityGuard(DEFAULT_OPERATING_PROFILE, queue);
      const result = await guard.check('git:commit');
      assert.equal(result.allowed, false);
      assert.equal(queue.getPending()[0].toolCall.tool, 'repoWrites');
    });

    it('a repeat of the same action reuses the pending record instead of duplicating it', async () => {
      const queue = makeQueue();
      const guard = new AuthorityGuard(DEFAULT_OPERATING_PROFILE, queue);
      const first = await guard.check('externalPost', { payload: { channel: '#general' } });
      const second = await guard.check('externalPost', { payload: { channel: '#general' } });
      assert.equal(second.queueId, first.queueId);
      assert.equal(queue.getPending().length, 1);
    });

    it('distinct payloads for the same action type queue as distinct records', async () => {
      const queue = makeQueue();
      const guard = new AuthorityGuard(DEFAULT_OPERATING_PROFILE, queue);
      await guard.check('externalPost', { payload: { channel: '#general' } });
      await guard.check('externalPost', { payload: { channel: '#eng' } });
      assert.equal(queue.getPending().length, 2);
    });
  });

  describe('auto-approved via queue', () => {
    it('allows an action once an identical prior request has been approved', async () => {
      const queue = makeQueue();
      const guard = new AuthorityGuard(DEFAULT_OPERATING_PROFILE, queue);

      const queued = await guard.check('externalPost');
      queue.approve(queued.queueId);

      const result = await guard.check('externalPost');
      assert.equal(result.allowed, true);
      assert.equal(result.mode, 'auto-approved');
      // The approved record is reused rather than a second one being queued.
      assert.equal(queue.list().length, 1);
    });
  });

  describe('denied level', () => {
    it('rejects denied actions immediately', async () => {
      const profile = {
        ...DEFAULT_OPERATING_PROFILE,
        authority: { ...DEFAULT_OPERATING_PROFILE.authority, repoWrites: 'denied' },
      };
      const queue = makeQueue();
      const guard = new AuthorityGuard(profile, queue);
      const result = await guard.check('repoWrites');
      assert.equal(result.allowed, false);
      assert.equal(result.mode, 'denied');
      assert.equal(queue.getPending().length, 0);
    });
  });

  describe('no queue', () => {
    it('denies approval-queued actions when no queue is provided', async () => {
      const guard = new AuthorityGuard(DEFAULT_OPERATING_PROFILE, null);
      const result = await guard.check('externalPost');
      assert.equal(result.allowed, false);
      assert.equal(result.mode, 'no-queue');
    });

    it('still allows autonomous actions with no queue', async () => {
      const guard = new AuthorityGuard(DEFAULT_OPERATING_PROFILE, null);
      const result = await guard.check('read');
      assert.equal(result.allowed, true);
    });
  });

  describe('unknown action type', () => {
    it('defaults to approval-queued (fail-safe) for unknown types', async () => {
      const guard = new AuthorityGuard(DEFAULT_OPERATING_PROFILE, makeQueue());
      const result = await guard.check('some:future:action');
      assert.equal(result.allowed, false);
      assert.equal(result.mode, 'queued');
    });
  });

  describe('checkSync', () => {
    it('returns allowed for autonomous actions', () => {
      const guard = new AuthorityGuard(DEFAULT_OPERATING_PROFILE, makeQueue());
      const result = guard.checkSync('read');
      assert.equal(result.allowed, true);
    });

    it('returns not allowed for approval-queued actions', () => {
      const guard = new AuthorityGuard(DEFAULT_OPERATING_PROFILE, makeQueue());
      const result = guard.checkSync('externalPost');
      assert.equal(result.allowed, false);
    });
  });

  describe('summary', () => {
    it('returns autonomous, queued, and denied buckets', () => {
      const guard = new AuthorityGuard(DEFAULT_OPERATING_PROFILE, makeQueue());
      const s = guard.summary();
      assert.ok(s.autonomous.includes('read'));
      assert.ok(s.autonomous.includes('summarize'));
      assert.ok(s.autonomous.includes('draftArtifacts'));
      assert.ok(s.queued.includes('createIssues'));
      assert.ok(s.queued.includes('externalPost'));
      assert.ok(s.queued.includes('repoWrites'));
      assert.deepEqual(s.denied, []);
    });
  });

  describe('null/missing profile', () => {
    it('defaults to approval-queued for everything when profile is null', async () => {
      const guard = new AuthorityGuard(null, makeQueue());
      const result = await guard.check('read');
      assert.equal(result.allowed, false);
      assert.equal(result.mode, 'queued');
    });
  });
});
