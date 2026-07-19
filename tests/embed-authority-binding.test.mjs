/**
 * tests/embed-authority-binding.test.mjs — AuthorityGuard embedBindings enforcement (LMCP-E4).
 *
 * Proves the excessive-agency gap is closed: an embed-originated proposal
 * naming a `<providerId>.<writeKind>` token outside the specialist's
 * `embedBindings.proposals[]` grant is denied before it ever reaches the
 * ApprovalQueue, and a specialist with no grant at all is denied outright.
 * Non-proposal checks (no `meta.proposal`) are unaffected — this is additive
 * enforcement layered in front of the existing authority-level/queue logic.
 *
 * Uses the real ApprovalQueue (in-memory, no persistPath) rather than a mock,
 * so these tests exercise the actual enqueue/findByToolArgs contract.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AuthorityGuard } from '../lib/embed/authority-guard.mjs';
import { ApprovalQueue } from '../lib/embed/approval-queue.mjs';
import { DEFAULT_OPERATING_PROFILE } from '../lib/embed/config.mjs';

function makeQueue() {
  return new ApprovalQueue();
}

const EMBED_BINDINGS = {
  'operations': {
    providers: [
      { id: 'atlassian-jira', capabilities: ['read', 'search'] },
      { id: 'slack', capabilities: ['read', 'search'] },
    ],
    proposals: ['atlassian-jira.createIssue', 'slack.postMessage'],
  },
  'product-manager': {
    providers: [{ id: 'atlassian-jira', capabilities: ['read', 'search'] }],
    proposals: ['atlassian-jira.createIssue'],
  },
};

describe('AuthorityGuard embedBindings enforcement', () => {
  describe('proposal within grant', () => {
    it('proceeds to ordinary authority-level check (queued, not denied) for a granted proposal', async () => {
      const queue = makeQueue();
      const guard = new AuthorityGuard(DEFAULT_OPERATING_PROFILE, queue, EMBED_BINDINGS);
      const result = await guard.check('externalPost', {
        description: 'Create Jira ticket for execution gap',
        proposal: { specialistId: 'operations', providerId: 'atlassian-jira', writeKind: 'createIssue' },
      });
      assert.equal(result.allowed, false);
      assert.equal(result.mode, 'queued');
      assert.equal(queue.getPending().length, 1);
    });

    it('a second granted provider/writeKind pair for the same specialist also proceeds', async () => {
      const guard = new AuthorityGuard(DEFAULT_OPERATING_PROFILE, makeQueue(), EMBED_BINDINGS);
      const result = await guard.check('externalPost', {
        proposal: { specialistId: 'operations', providerId: 'slack', writeKind: 'postMessage' },
      });
      assert.equal(result.mode, 'queued');
    });
  });

  describe('proposal outside grant', () => {
    it('denies a write kind the specialist never registered for that provider', async () => {
      const queue = makeQueue();
      const guard = new AuthorityGuard(DEFAULT_OPERATING_PROFILE, queue, EMBED_BINDINGS);
      const result = await guard.check('externalPost', {
        proposal: { specialistId: 'operations', providerId: 'atlassian-jira', writeKind: 'deleteIssue' },
      });
      assert.equal(result.allowed, false);
      assert.equal(result.mode, 'denied');
      assert.match(result.reason, /not granted to propose/);
      assert.equal(queue.getPending().length, 0, 'a denied proposal must never reach the ApprovalQueue');
    });

    it('denies a proposal against a provider the specialist has no proposals[] entry for', async () => {
      const queue = makeQueue();
      const guard = new AuthorityGuard(DEFAULT_OPERATING_PROFILE, queue, EMBED_BINDINGS);
      const result = await guard.check('externalPost', {
        proposal: { specialistId: 'product-manager', providerId: 'slack', writeKind: 'postMessage' },
      });
      assert.equal(result.allowed, false);
      assert.equal(result.mode, 'denied');
      assert.equal(queue.getPending().length, 0);
    });

    it('denies every proposal for a specialist with no embedBindings entry at all', async () => {
      const queue = makeQueue();
      const guard = new AuthorityGuard(DEFAULT_OPERATING_PROFILE, queue, EMBED_BINDINGS);
      const result = await guard.check('externalPost', {
        proposal: { specialistId: 'cx-unbound-specialist', providerId: 'atlassian-jira', writeKind: 'createIssue' },
      });
      assert.equal(result.allowed, false);
      assert.equal(result.mode, 'denied');
      assert.match(result.reason, /no embedBindings grant/);
      assert.equal(queue.getPending().length, 0);
    });

    it('denial happens even when an identical action was previously approved', async () => {
      const queue = makeQueue();
      const guard = new AuthorityGuard(DEFAULT_OPERATING_PROFILE, queue, EMBED_BINDINGS);
      // Pre-approve the authority-level bucket this proposal would otherwise land in.
      const primed = await guard.check('externalPost');
      queue.approve(primed.queueId);

      const result = await guard.check('externalPost', {
        proposal: { specialistId: 'operations', providerId: 'atlassian-jira', writeKind: 'deleteIssue' },
      });
      assert.equal(result.allowed, false, 'binding denial must precede auto-approval');
      assert.equal(result.mode, 'denied');
    });

    it('denial happens even when the authority level for the action is autonomous', async () => {
      const profile = {
        ...DEFAULT_OPERATING_PROFILE,
        authority: { ...DEFAULT_OPERATING_PROFILE.authority, externalPost: 'autonomous' },
      };
      const guard = new AuthorityGuard(profile, makeQueue(), EMBED_BINDINGS);
      const result = await guard.check('externalPost', {
        proposal: { specialistId: 'operations', providerId: 'atlassian-jira', writeKind: 'deleteIssue' },
      });
      assert.equal(result.allowed, false, 'binding grant must be checked before the authority level, not after');
      assert.equal(result.mode, 'denied');
    });
  });

  describe('backward compatibility (no proposal meta)', () => {
    it('non-embed callers with no meta.proposal are unaffected by embedBindings', async () => {
      const guard = new AuthorityGuard(DEFAULT_OPERATING_PROFILE, makeQueue(), EMBED_BINDINGS);
      const result = await guard.check('read');
      assert.equal(result.allowed, true);
      assert.equal(result.mode, 'autonomous');
    });

    it('omitting the third constructor argument (embedBindings) behaves exactly as before', async () => {
      const guard = new AuthorityGuard(DEFAULT_OPERATING_PROFILE, makeQueue());
      const result = await guard.check('externalPost', { description: 'Post to #general' });
      assert.equal(result.allowed, false);
      assert.equal(result.mode, 'queued');
    });
  });
});
