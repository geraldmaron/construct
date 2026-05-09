/**
 * tests/embed-authority-guard.test.mjs — AuthorityGuard unit tests.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { AuthorityGuard } from '../lib/embed/authority-guard.mjs';
import { DEFAULT_OPERATING_PROFILE } from '../lib/embed/config.mjs';

// ─── Minimal ApprovalQueue stub ──────────────────────────────────────────────

let queuedItems = [];
function makeQueue({ autoApproveAll = false } = {}) {
  queuedItems = [];
  return {
    approvalMode: (actionType) => (autoApproveAll ? 'auto' : 'human'),
    enqueue: (item) => {
      const id = `q-${queuedItems.length + 1}`;
      queuedItems.push({ id, ...item });
      return id;
    },
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('AuthorityGuard', () => {
  describe('autonomous actions', () => {
    it('allows read without queuing', async () => {
      const guard = new AuthorityGuard(DEFAULT_OPERATING_PROFILE, makeQueue());
      const result = await guard.check('read');
      assert.equal(result.allowed, true);
      assert.equal(result.mode, 'autonomous');
      assert.equal(queuedItems.length, 0);
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
      const guard = new AuthorityGuard(DEFAULT_OPERATING_PROFILE, makeQueue());
      const result = await guard.check('externalPost', { description: 'Post to #general' });
      assert.equal(result.allowed, false);
      assert.equal(result.mode, 'queued');
      assert.ok(result.queueId, 'should have a queueId');
      assert.equal(queuedItems.length, 1);
      assert.equal(queuedItems[0].type, 'externalPost');
      assert.equal(queuedItems[0].description, 'Post to #general');
    });

    it('queues slack:post (maps to externalPost)', async () => {
      const guard = new AuthorityGuard(DEFAULT_OPERATING_PROFILE, makeQueue());
      const result = await guard.check('slack:post');
      assert.equal(result.allowed, false);
      assert.equal(result.mode, 'queued');
      assert.equal(queuedItems[0].authorityKey, 'externalPost');
    });

    it('queues createIssues', async () => {
      const guard = new AuthorityGuard(DEFAULT_OPERATING_PROFILE, makeQueue());
      const result = await guard.check('createIssues');
      assert.equal(result.allowed, false);
      assert.equal(result.mode, 'queued');
    });

    it('queues issue:create (maps to createIssues)', async () => {
      const guard = new AuthorityGuard(DEFAULT_OPERATING_PROFILE, makeQueue());
      const result = await guard.check('issue:create');
      assert.equal(result.allowed, false);
      assert.equal(queuedItems[0].authorityKey, 'createIssues');
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
      const guard = new AuthorityGuard(DEFAULT_OPERATING_PROFILE, makeQueue());
      const result = await guard.check('git:commit');
      assert.equal(result.allowed, false);
      assert.equal(queuedItems[0].authorityKey, 'repoWrites');
    });
  });

  describe('auto-approved via queue', () => {
    it('allows queued action when queue says auto', async () => {
      const guard = new AuthorityGuard(DEFAULT_OPERATING_PROFILE, makeQueue({ autoApproveAll: true }));
      const result = await guard.check('externalPost');
      assert.equal(result.allowed, true);
      assert.equal(result.mode, 'auto-approved');
      assert.equal(queuedItems.length, 0);
    });
  });

  describe('denied level', () => {
    it('rejects denied actions immediately', async () => {
      const profile = {
        ...DEFAULT_OPERATING_PROFILE,
        authority: { ...DEFAULT_OPERATING_PROFILE.authority, repoWrites: 'denied' },
      };
      const guard = new AuthorityGuard(profile, makeQueue());
      const result = await guard.check('repoWrites');
      assert.equal(result.allowed, false);
      assert.equal(result.mode, 'denied');
      assert.equal(queuedItems.length, 0);
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
